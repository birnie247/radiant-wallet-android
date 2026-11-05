import { useEffect, useRef } from "react";
import { isBiometricPromptOpen } from "./biometric";

/**
 * Lock the wallet when the app leaves the foreground.
 *
 * Android's WebView reports Page Visibility, so a `visibilitychange` to
 * "hidden" is what happens when the activity is paused — the same signal the OS
 * uses for a tab that is no longer on screen. Two extra sources exist because a
 * lock that silently fails is a security failure, not a cosmetic one:
 *
 *   • `pagehide` / `pageshow` cover the paths that skip `visibilitychange`
 *     (bfcache restores, navigations).
 *   • a heartbeat: a WebView that is not being rendered stops running timers, so
 *     a large gap between ticks means we were not on screen even if no event
 *     arrived. The floor keeps a slow key derivation from looking like a trip
 *     to the background.
 *
 * `onLock` must be idempotent — it can be reached from several of these paths.
 */
export interface AutoLockOptions {
  /** Locking only means something with a wallet open. */
  enabled: boolean;
  /** Background time allowed before locking. 0 = lock as soon as the app hides. */
  thresholdMs: number;
  /** Called when the wallet has to lock. */
  onLock: () => void;
}

const HEARTBEAT_MS = 1_000;
const HEARTBEAT_FLOOR_MS = 10_000;

/**
 * A system prompt can momentarily toggle window visibility. Being "away" for
 * less than this is not a background trip, and must never cancel the payment
 * the user just authenticated.
 */
const PROMPT_GRACE_MS = 2_000;

export function useAutoLock({
  enabled,
  thresholdMs,
  onLock,
}: AutoLockOptions): void {
  // Latest props via refs, so the listeners are installed exactly once and can
  // never run against a stale threshold or a stale `lock` closure.
  const onLockRef = useRef(onLock);
  onLockRef.current = onLock;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const thresholdRef = useRef(thresholdMs);
  thresholdRef.current = thresholdMs;

  useEffect(() => {
    /** When the app went to the background; 0 when it did not. */
    let hiddenAt = 0;
    /** A lock fell due while a biometric prompt owned the screen. */
    let deferred = false;

    const lockNow = () => {
      hiddenAt = 0;
      deferred = false;
      if (!enabledRef.current) return;
      onLockRef.current();
    };

    /**
     * Lock, unless a biometric prompt is on screen. Wiping the session with a
     * prompt open would discard the CryptoObject the user is approving and drop
     * the action they authenticated on the floor.
     */
    const lockOrDefer = () => {
      if (!enabledRef.current) return;
      if (isBiometricPromptOpen()) {
        deferred = true;
        return;
      }
      lockNow();
    };

    const goHidden = () => {
      hiddenAt = Date.now();
      // threshold 0: lock on the way out, so the wallet is never sitting
      // unlocked behind the app switcher or in the Recents snapshot.
      if (thresholdRef.current <= 0) lockOrDefer();
    };

    const comeBack = () => {
      const away = hiddenAt ? Date.now() - hiddenAt : 0;
      hiddenAt = 0;
      if (deferred) {
        // Still mid-prompt, or too brief to count as leaving: keep the lock
        // pending and decide on the next real trip.
        if (isBiometricPromptOpen() || away < PROMPT_GRACE_MS) return;
        lockNow();
        return;
      }
      if (away > 0 && away >= thresholdRef.current) lockOrDefer();
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") goHidden();
      else comeBack();
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", goHidden);
    window.addEventListener("pageshow", comeBack);

    let last = Date.now();
    const ticker = window.setInterval(() => {
      const now = Date.now();
      const gap = now - last;
      last = now;
      if (gap < Math.max(HEARTBEAT_FLOOR_MS, thresholdRef.current)) return;
      lockOrDefer();
    }, HEARTBEAT_MS);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", goHidden);
      window.removeEventListener("pageshow", comeBack);
      window.clearInterval(ticker);
    };
  }, []);
}
