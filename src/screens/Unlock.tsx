import { useEffect, useRef, useState } from "react";
import { deleteVault } from "../lib/vault";
import {
  biometricStatus,
  cancelBiometricPrompt,
  isBiometricCancellation,
  type BiometricStatus,
} from "../lib/biometric";
import BrandMark from "../components/BrandMark";

export default function Unlock({
  onUnlock,
  onBiometricUnlock,
}: {
  onUnlock: (passphrase: string) => Promise<void>;
  onBiometricUnlock: () => Promise<void>;
}) {
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [bio, setBio] = useState<BiometricStatus | null>(null);
  const autoPrompted = useRef(false);

  useEffect(() => {
    let alive = true;
    biometricStatus()
      .then((status) => {
        if (alive) setBio(status);
      })
      .catch(() => {
        /* biometrics are optional */
      });
    return () => {
      alive = false;
    };
  }, []);

  const biometricReady = bio?.platform === true && bio.available && bio.enrolled;

  async function submit() {
    setError("");
    setWorking(true);
    try {
      await onUnlock(passphrase);
    } catch (e) {
      setError((e as Error).message);
      setPassphrase("");
      setWorking(false);
    }
  }

  async function unlockWithFace() {
    setError("");
    setWorking(true);
    try {
      await onBiometricUnlock();
    } catch (e) {
      // Cancelling the system prompt is normal; stay on this screen quietly.
      const message = (e as Error).message || "Biometric unlock failed";
      setError(isBiometricCancellation(message) ? "" : message);
    } finally {
      // A prompt that never reports back must not leave the passphrase button
      // disabled — the user has to keep a way into their own wallet.
      setWorking(false);
    }
  }

  // Offer the prompt as soon as we know it can work: the whole point of the
  // hardware key is that unlocking does not require hunting for a button. Only
  // once per mount, so cancelling does not bounce straight back into the prompt.
  useEffect(() => {
    if (!biometricReady || autoPrompted.current) return;
    autoPrompted.current = true;
    void unlockWithFace();
  }, [biometricReady]);

  // Drop a prompt that is still open if this screen goes away mid-prompt.
  useEffect(() => {
    return () => {
      void cancelBiometricPrompt();
    };
  }, []);

  return (
    <div className="app">
      <div
        className="splash"
        style={{ justifyContent: "flex-start", paddingTop: 48 }}
      >
        <BrandMark />
        <div>
          <div style={{ fontWeight: 700, fontSize: 20 }}>Welcome back</div>
          <div style={{ color: "var(--text-faint)", fontSize: 13 }}>
            {biometricReady
              ? "Unlock with your biometric, or your passphrase"
              : bio?.available === true && bio.reason
                ? bio.reason
                : "Enter your passphrase to unlock"}
          </div>
        </div>
      </div>

      <div className="content" style={{ justifyContent: "flex-end", gap: 14 }}>
        {biometricReady && (
          <>
            <button
              className="btn primary"
              disabled={working}
              onClick={unlockWithFace}
            >
              {working ? "Waiting for biometric…" : "Unlock with biometrics"}
            </button>
            <div className="hint center">or use your passphrase</div>
          </>
        )}

        <div className="field">
          <label>Passphrase</label>
          <input
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder="Your wallet passphrase"
            autoCapitalize="none"
            autoCorrect="off"
            onKeyDown={(e) => {
              if (e.key === "Enter" && passphrase.length > 0) void submit();
            }}
          />
        </div>
        {error && <div className="error">{error}</div>}
        <button
          className={biometricReady ? "btn" : "btn primary"}
          disabled={working || passphrase.length === 0}
          onClick={submit}
        >
          {working ? "Unlocking…" : "Unlock"}
        </button>

        <hr className="hr" />

        {confirmWipe ? (
          <div className="danger-zone stack">
            <div style={{ fontSize: 13 }}>
              This permanently deletes the wallet from this device. You can only
              get your funds back with your written recovery phrase.
            </div>
            <div className="btn-row">
              <button
                className="btn ghost"
                onClick={() => setConfirmWipe(false)}
              >
                Cancel
              </button>
              <button
                className="btn danger"
                onClick={() => {
                  deleteVault();
                  window.location.reload();
                }}
              >
                Delete wallet
              </button>
            </div>
          </div>
        ) : (
          <button
            className="btn ghost small"
            onClick={() => setConfirmWipe(true)}
          >
            Forgot passphrase?
          </button>
        )}
      </div>
    </div>
  );
}
