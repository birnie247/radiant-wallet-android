/**
 * Auto-lock policy: how long the app may sit in the background before the
 * wallet locks itself and asks for a biometric or the passphrase again.
 *
 * The default is 0 — lock the moment the app leaves the foreground. A wallet is
 * not a browser tab: whatever was on screen (balance, addresses, a half-filled
 * send form) should not still be readable by whoever picks the phone up next,
 * and the decrypted mnemonic should not stay resident in the WebView heap while
 * the app is not in use.
 *
 * Stored in localStorage next to the other UI preferences (the vault itself is
 * in vault.ts). As with every stored setting, the value is validated on read
 * rather than trusted: a tampered or stale value must not be able to disable
 * locking.
 */

/** Key under which the policy is persisted. */
export const AUTO_LOCK_KEY = "rxd.security.autoLockMs";

export interface AutoLockOption {
  /** User-facing label, also used to describe the active policy. */
  label: string;
  /** Background time allowed before locking. 0 = lock on the way out. */
  ms: number;
}

/** Offered choices, shortest first. */
export const AUTO_LOCK_OPTIONS: AutoLockOption[] = [
  { label: "Immediately", ms: 0 },
  { label: "After 15 seconds", ms: 15_000 },
  { label: "After 30 seconds", ms: 30_000 },
  { label: "After 1 minute", ms: 60_000 },
  { label: "After 5 minutes", ms: 5 * 60_000 },
  { label: "After 15 minutes", ms: 15 * 60_000 },
];

/** Lock on the way out unless the user has chosen otherwise. */
export const DEFAULT_AUTO_LOCK_MS = 0;

/**
 * Turn a raw stored value into a policy.
 *
 * Anything that is not one of the offered values (missing, garbage, a value
 * written by a hypothetical future build) falls back to the default, which is
 * the strictest setting — a bad read must not weaken the lock.
 */
export function parseAutoLockMs(raw: string | null): number {
  if (raw === null || raw === "") return DEFAULT_AUTO_LOCK_MS;
  const ms = Number(raw);
  if (!Number.isFinite(ms)) return DEFAULT_AUTO_LOCK_MS;
  return AUTO_LOCK_OPTIONS.some((option) => option.ms === ms)
    ? ms
    : DEFAULT_AUTO_LOCK_MS;
}

/** Read the persisted policy. */
export function loadAutoLockMs(): number {
  try {
    return parseAutoLockMs(localStorage.getItem(AUTO_LOCK_KEY));
  } catch {
    // Storage unavailable (private mode, quota) — treat it as "lock immediately".
    return DEFAULT_AUTO_LOCK_MS;
  }
}

/** Persist a policy. Best effort: the in-memory value still applies this run. */
export function saveAutoLockMs(ms: number): void {
  try {
    localStorage.setItem(AUTO_LOCK_KEY, String(ms));
  } catch {
    /* ignore storage failure */
  }
}

/** Short description of a policy, e.g. "immediately", "after 15 seconds". */
export function describeAutoLock(ms: number): string {
  const option = AUTO_LOCK_OPTIONS.find((candidate) => candidate.ms === ms);
  return (option ?? AUTO_LOCK_OPTIONS[0]).label.toLowerCase();
}
