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

/**
 * Prompts currently on screen.
 *
 * The auto-lock (src/lib/useAutoLock.ts) needs to know: tearing the session down
 * while the user is approving a payment would discard the CryptoObject the
 * prompt is bound to and strand the action they just authenticated.
 */
let promptsInFlight = 0;

function beginPrompt(): void {
  promptsInFlight++;
}

function endPrompt(): void {
  promptsInFlight = Math.max(0, promptsInFlight - 1);
}

/** True while a system biometric prompt is open. */
export function isBiometricPromptOpen(): boolean {
  return promptsInFlight > 0;
}

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

/**
 * Decides whether the unlock screen may raise a biometric prompt right now.
 *
 * A system prompt can only be presented to an app that is genuinely on screen.
 * When the wallet auto-locks as the app goes to the background, the Unlock
 * screen mounts while it is still hidden — asking for a prompt then produced a
 * permanent "Waiting for biometric…" with no prompt, and nothing retried it when
 * the app was reopened. So visibility is a hard requirement, and the caller
 * re-asks on visibilitychange/pageshow rather than prompting blind.
 *
 * Extracted so the rule can be tested without a device.
 */
export function shouldAutoPromptBiometric(state: {
  /** Biometric is available AND enrolled for this wallet. */
  ready: boolean;
  /** Already prompted once on this mount (don't re-prompt on every resume). */
  alreadyPrompted: boolean;
  /** A prompt is already in flight. */
  promptOpen: boolean;
  /** `document.visibilityState`. */
  visibility: string;
}): boolean {
  if (!state.ready || state.alreadyPrompted || state.promptOpen) return false;
  return state.visibility === "visible";
}

/** True when a biometric message is just the user backing out of the prompt. */
export function isBiometricCancellation(message: string): boolean {
  return /cancel/i.test(message);
}

/**
 * How long to wait for an answer to a prompt before giving up.
 *
 * The native side has its own 120s watchdog, but the JS caller must not depend
 * on that arriving: an unanswered prompt used to leave the UI stuck on
 * "Waiting for biometric…" forever, with every retry rejected because the
 * plugin still thought a request was in flight. This is the layer the user
 * actually sees, so it gives up first and says something useful.
 */
export const PROMPT_TIMEOUT_MS = 75_000;

/**
 * Resolve with `work`, or reject with `message` after `ms` — running
 * `onTimeout` first so any native prompt is actually dismissed.
 *
 * Extracted so the timing behaviour can be tested without a device.
 */
export async function raceWithTimeout<T>(
  work: Promise<T>,
  ms: number,
  onTimeout: () => void | Promise<void>,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      Promise.resolve(onTimeout()).catch(() => undefined);
      reject(new Error(message));
    }, ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

const TIMED_OUT =
  "The biometric prompt timed out. Unlock with your passphrase instead.";

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
  beginPrompt();
  try {
    await raceWithTimeout(
      BiometricVault.enroll({
        alias: BIOMETRIC_ALIAS,
        secret: JSON.stringify(secrets),
      }),
      PROMPT_TIMEOUT_MS,
      cancelBiometricPrompt,
      TIMED_OUT,
    );
  } finally {
    endPrompt();
  }
}

/** Prompt for a biometric and return the wallet secrets it unwraps. */
export async function unlockWithBiometric(): Promise<WalletSecrets> {
  if (!isBiometricPlatform()) {
    throw new Error("Biometric unlock is only available in the Android app");
  }
  beginPrompt();
  try {
    const { secret } = await raceWithTimeout(
      BiometricVault.unlock({ alias: BIOMETRIC_ALIAS }),
      PROMPT_TIMEOUT_MS,
      cancelBiometricPrompt,
      TIMED_OUT,
    );
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
  } finally {
    endPrompt();
  }
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
