/**
 * JS bridge to the app-local `BiometricVault` Capacitor plugin.
 *
 * The native side (BiometricVaultPlugin.java) owns an AES-256-GCM key inside the
 * AndroidKeyStore that requires a strong biometric for every use. It stores the
 * *entire* wallet secret blob (mnemonic + network + server prefs, as JSON)
 * encrypted under that key, so biometric unlock restores the full wallet state,
 * not just the phrase.
 *
 * Everything is optional: the wallet must remain usable with the passphrase
 * alone, so every call is guarded and failures surface as ordinary errors the UI
 * can ignore.
 */
import { Capacitor, registerPlugin } from "@capacitor/core";
import type { WalletSecrets } from "./vault";

/** Key alias under which the wallet secret is stored in the Keystore. */
export const BIOMETRIC_ALIAS = "rxd-wallet-secrets";

interface BiometricVaultApi {
  isAvailable(): Promise<{ available: boolean; reason: string }>;
  isEnrolled(options: {
    alias: string;
  }): Promise<{ enrolled: boolean; invalidated?: boolean }>;
  enroll(options: { alias: string; secret: string }): Promise<{ ok: boolean }>;
  unlock(options: { alias: string }): Promise<{ secret: string }>;
  disable(options: { alias: string }): Promise<{ ok: boolean }>;
  cancel(): Promise<{ ok: boolean }>;
}

const BiometricVault = registerPlugin<BiometricVaultApi>("BiometricVault");

/** True only inside the Android app — the plugin does not exist on the web. */
export function isBiometricPlatform(): boolean {
  return Capacitor.isNativePlatform();
}

export interface BiometricStatus {
  platform: boolean;
  available: boolean;
  enrolled: boolean;
  /**
   * The hardware key was invalidated by a biometric change (or by the user
   * removing the screen lock), so the stored secret is unusable. The native side
   * clears it in the same call, which is why `enrolled` is already false by the
   * time this arrives.
   */
  invalidated: boolean;
  reason: string;
}

function offline(reason: string): BiometricStatus {
  return {
    platform: false,
    available: false,
    enrolled: false,
    invalidated: false,
    reason,
  };
}

export async function biometricStatus(): Promise<BiometricStatus> {
  if (!isBiometricPlatform()) {
    return offline("Biometric unlock is only available in the Android app");
  }
  try {
    const availability = await BiometricVault.isAvailable();
    let enrolled = false;
    let invalidated = false;
    if (availability.available) {
      const result = await BiometricVault.isEnrolled({ alias: BIOMETRIC_ALIAS });
      enrolled = result.enrolled === true;
      invalidated = result.invalidated === true;
    }
    return {
      platform: true,
      available: availability.available === true,
      enrolled,
      invalidated,
      reason: invalidated
        ? "Your device biometrics changed — enable biometric unlock again"
        : availability.reason ?? "",
    };
  } catch (e) {
    return {
      platform: true,
      available: false,
      enrolled: false,
      invalidated: false,
      reason: (e as Error).message,
    };
  }
}

/** True when a biometric message is just the user backing out of the prompt. */
export function isBiometricCancellation(message: string): boolean {
  return /cancel/i.test(message);
}

/**
 * Encrypt the wallet secrets under the biometric key.
 * Triggers a system biometric prompt; the user must confirm.
 */
export async function enableBiometricUnlock(
  secrets: WalletSecrets,
): Promise<void> {
  if (!isBiometricPlatform()) {
    throw new Error("Biometric unlock is only available in the Android app");
  }
  await BiometricVault.enroll({
    alias: BIOMETRIC_ALIAS,
    secret: JSON.stringify(secrets),
  });
}

/** Prompt for a biometric and return the wallet secrets it unwraps. */
export async function unlockWithBiometric(): Promise<WalletSecrets> {
  if (!isBiometricPlatform()) {
    throw new Error("Biometric unlock is only available in the Android app");
  }
  const { secret } = await BiometricVault.unlock({ alias: BIOMETRIC_ALIAS });
  let parsed: WalletSecrets;
  try {
    parsed = JSON.parse(secret) as WalletSecrets;
  } catch {
    throw new Error("Stored biometric data is unreadable — use your passphrase");
  }
  if (!parsed?.mnemonic) {
    throw new Error("Stored biometric data is incomplete — use your passphrase");
  }
  return parsed;
}

/** Drop a prompt that is still open, e.g. when its screen unmounts. */
export async function cancelBiometricPrompt(): Promise<void> {
  if (!isBiometricPlatform()) return;
  try {
    await BiometricVault.cancel();
  } catch {
    /* Nothing was pending. */
  }
}

/** Remove the Keystore key and the stored ciphertext. */
export async function disableBiometricUnlock(): Promise<void> {
  if (!isBiometricPlatform()) return;
  try {
    await BiometricVault.disable({ alias: BIOMETRIC_ALIAS });
  } catch {
    /* Nothing to clean up if the plugin is missing. */
  }
}
