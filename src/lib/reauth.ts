/**
 * Step-up authentication for actions that move money.
 *
 * An unlocked session lives in the WebView heap (see README, "Security model"),
 * so being unlocked must not, on its own, authorise a payment. Every spend goes
 * through one of the two functions here first:
 *
 *   • the passphrase, re-derived against the encrypted vault, or
 *   • a biometric, unwrapped from the AndroidKeyStore key (per-use auth).
 *
 * Passphrase and biometric are equally acceptable — this is deliberately not
 * "passphrase, and biometrics as a shortcut for convenience". Both prove
 * possession of a secret the session itself does not hold in the clear.
 *
 * The extra check that both perform: the secret that comes back must belong to
 * the wallet currently open. A vault can be replaced, or a stale biometric
 * enrolment can outlive the wallet it was made for, and signing with the wrong
 * seed would broadcast a transaction from an account the user did not mean to
 * spend. Better to refuse and ask again than to send the wrong funds.
 */
import { unlockVault, type WalletSecrets } from "./vault";
import { unlockWithBiometric } from "./biometric";

/** Which proof the user supplied. */
export type ConfirmMethod = "passphrase" | "biometric";

/** Collapse spacing/case so a phrase re-typed or re-wrapped still matches. */
function normaliseMnemonic(mnemonic: string | undefined): string {
  return (mnemonic ?? "").trim().toLowerCase().split(/\s+/).join(" ");
}

/** Throw unless the confirmed secret is the wallet that is currently open. */
function assertSameWallet(
  confirmed: WalletSecrets,
  session: WalletSecrets,
): void {
  if (
    normaliseMnemonic(confirmed.mnemonic) !== normaliseMnemonic(session.mnemonic)
  ) {
    throw new Error(
      "That unlocks a different wallet — lock and unlock before sending",
    );
  }
}

/** Re-derive the vault with the passphrase and check it is this wallet. */
export async function confirmWithPassphrase(
  passphrase: string,
  session: WalletSecrets,
): Promise<void> {
  if (!passphrase) {
    throw new Error("Enter your passphrase to authorise this payment");
  }
  const confirmed = await unlockVault(passphrase);
  assertSameWallet(confirmed, session);
}

/**
 * Prompt for a biometric and check the unwrapped secret is this wallet.
 * Rejects with the native side's message when biometrics are unavailable, so
 * callers can fall back to the passphrase field.
 */
export async function confirmWithBiometric(
  session: WalletSecrets,
): Promise<void> {
  const confirmed = await unlockWithBiometric();
  assertSameWallet(confirmed, session);
}
