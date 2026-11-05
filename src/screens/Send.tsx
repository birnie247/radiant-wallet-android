import { useEffect, useState } from "react";
import { formatRxd, parseRxd, shortId } from "../lib/money";
import {
  biometricStatus,
  cancelBiometricPrompt,
  isBiometricCancellation,
} from "../lib/biometric";
import {
  confirmWithBiometric,
  confirmWithPassphrase,
  type ConfirmMethod,
} from "../lib/reauth";
import {
  FAST_FEE_RATE,
  MIN_FEE_RATE,
  broadcast,
  buildPayment,
  checkAddress,
  type PaymentPlan,
} from "../lib/wallet";
import type { Nav } from "../types";

const FEE_TIERS: { label: string; rate: bigint; note: string }[] = [
  { label: "Standard", rate: MIN_FEE_RATE, note: "~10k photons/byte" },
  { label: "Fast", rate: 25_000n, note: "~25k photons/byte" },
  { label: "Priority", rate: FAST_FEE_RATE, note: "~50k photons/byte" },
];

export default function Send({ nav }: { nav: Nav }) {
  const { session } = nav;
  const network = session.secrets.network;

  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [feeRate, setFeeRate] = useState<bigint>(MIN_FEE_RATE);
  const [plan, setPlan] = useState<PaymentPlan | null>(null);
  const [txid, setTxid] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [biometricReady, setBiometricReady] = useState(false);

  // Is biometric confirmation on the table? The passphrase always is.
  useEffect(() => {
    let alive = true;
    biometricStatus()
      .then((status) => {
        if (alive) {
          setBiometricReady(
            status.platform === true && status.available && status.enrolled,
          );
        }
      })
      .catch(() => {
        /* biometrics are optional — the passphrase field is always there */
      });
    return () => {
      alive = false;
    };
  }, []);

  // Drop a prompt that is still open if this screen goes away mid-prompt.
  useEffect(() => {
    return () => {
      void cancelBiometricPrompt();
    };
  }, []);

  const trimmedTo = to.trim();
  const addressCheck = trimmedTo ? checkAddress(trimmedTo) : null;

  function review() {
    setError("");
    try {
      const photons = parseRxd(amount);
      const built = buildPayment({
        scan: session.scan,
        to: trimmedTo,
        amount: photons,
        feeRate,
        network,
      });
      setPlan(built);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function confirm(method: ConfirmMethod, passphrase: string) {
    if (!plan) return;
    setError("");
    setWorking(true);
    try {
      // Re-authenticate before moving funds (security report LOW/MED-3): an
      // unlocked session living in the JS heap must not, on its own, be
      // sufficient to authorise a payment. A biometric or the passphrase both
      // prove the person holding the phone is the owner.
      if (method === "biometric") {
        await confirmWithBiometric(session.secrets);
      } else {
        await confirmWithPassphrase(passphrase, session.secrets);
      }
    } catch (e) {
      // Backing out of the system prompt is not an error worth shouting about.
      const message = (e as Error).message || "Could not confirm this payment";
      setError(isBiometricCancellation(message) ? "" : message);
      setWorking(false);
      return;
    }
    try {
      const sent = await broadcast(session.client, plan);
      setTxid(sent);
      setPlan(null);
      await nav.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  }

  function useMax() {
    setError("");
    if (!addressCheck?.ok) {
      setError("Enter a valid destination address first");
      return;
    }
    // Walk the amount down until the wallet can actually fund it, so "Max"
    // never proposes an amount the fee would make unspendable.
    let candidate = session.scan.total;
    const step = feeRate * 10n;
    for (let i = 0; i < 12 && candidate > 0n; i++) {
      try {
        buildPayment({
          scan: session.scan,
          to: trimmedTo,
          amount: candidate,
          feeRate,
          network,
        });
        setAmount(formatRxd(candidate, 8).replace(/,/g, ""));
        return;
      } catch {
        candidate -= step;
      }
    }
    setError("Nothing spendable in this wallet");
  }

  if (txid) {
    return (
      <div className="app">
        <div className="topbar">
          <button className="icon-btn" onClick={() => nav.go("home")}>
            ×
          </button>
          <h1>Sent</h1>
        </div>
        <div className="content">
          <div className="success-box">
            Transaction broadcast to the Radiant network.
          </div>
          <div className="card">
            <div className="balance-label">Transaction ID</div>
            <div className="address-box" style={{ textAlign: "left" }}>
              {txid}
            </div>
          </div>
          <div className="hint">
            It can take a few minutes to confirm — Radiant targets a 5 minute
            block time. Your balance updates after the next refresh.
          </div>
          <button className="btn primary" onClick={() => nav.go("home")}>
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="topbar">
        <button className="icon-btn" onClick={() => nav.go("home")}>
          ←
        </button>
        <h1>Send RXD</h1>
      </div>

      <div className="content">
        <div className="field">
          <label>To</label>
          <input
            className="mono"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="Radiant address (starts with 1)"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          {addressCheck && !addressCheck.ok && (
            <div className="error">{addressCheck.error}</div>
          )}
          {addressCheck?.ok && <div className="hint">Address looks valid ✓</div>}
        </div>

        <div className="field">
          <label>Amount (RXD)</label>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00000000"
            inputMode="decimal"
            autoCorrect="off"
          />
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div className="hint">
              Available {formatRxd(session.scan.total, 8)} RXD
            </div>
            <button className="btn small ghost" onClick={useMax}>
              Max
            </button>
          </div>
        </div>

        <div className="field">
          <label>Network fee</label>
          <div className="btn-row">
            {FEE_TIERS.map((tier) => (
              <button
                key={tier.label}
                className={`btn small ${feeRate === tier.rate ? "primary" : ""}`}
                style={{ flex: 1 }}
                onClick={() => setFeeRate(tier.rate)}
                title={tier.note}
              >
                {tier.label}
              </button>
            ))}
          </div>
        </div>

        {error && !plan && <div className="error">{error}</div>}

        <div className="spacer" />
        <button
          className="btn primary"
          disabled={!addressCheck?.ok || !amount || working}
          onClick={review}
        >
          Review transaction
        </button>
      </div>

      {plan && (
        <ReviewSheet
          plan={plan}
          to={trimmedTo}
          amount={parseRxdSafe(amount)}
          working={working}
          error={error}
          biometricReady={biometricReady}
          onCancel={() => {
            void cancelBiometricPrompt();
            setPlan(null);
            setError("");
          }}
          onConfirm={confirm}
        />
      )}
    </div>
  );
}

function parseRxdSafe(value: string): bigint {
  try {
    return parseRxd(value);
  } catch {
    return 0n;
  }
}

function ReviewSheet({
  plan,
  to,
  amount,
  working,
  error,
  biometricReady,
  onCancel,
  onConfirm,
}: {
  plan: PaymentPlan;
  to: string;
  amount: bigint;
  working: boolean;
  error: string;
  biometricReady: boolean;
  onCancel: () => void;
  onConfirm: (method: ConfirmMethod, passphrase: string) => void;
}) {
  const total = amount + plan.fee;
  // Send-time re-authentication (security report LOW/MED-3).
  const [passphrase, setPassphrase] = useState("");
  // Which proof is in flight, so the right button reads "…waiting".
  const [pending, setPending] = useState<ConfirmMethod | null>(null);

  const submit = (method: ConfirmMethod, secret: string) => {
    setPending(method);
    onConfirm(method, secret);
  };

  return (
    <div className="sheet-backdrop" onClick={onCancel}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div style={{ fontWeight: 700, fontSize: 17 }}>Confirm payment</div>

        <div className="card tight" style={{ background: "var(--bg)" }}>
          <div className="row" style={{ paddingTop: 0 }}>
            <div className="grow">
              <div className="title">Sending</div>
            </div>
            <div className="value">{formatRxd(amount, 8)} RXD</div>
          </div>
          <div className="row">
            <div className="grow">
              <div className="title">To</div>
              <div className="sub">{shortId(to, 14, 10)}</div>
            </div>
          </div>
          <div className="row">
            <div className="grow">
              <div className="title">Network fee</div>
              <div className="sub">{plan.inputsUsed} input(s)</div>
            </div>
            <div className="value">{formatRxd(plan.fee, 8)}</div>
          </div>
          <div className="row">
            <div className="grow">
              <div className="title">Total deducted</div>
            </div>
            <div className="value">{formatRxd(total, 8)} RXD</div>
          </div>
        </div>

        {error && <div className="error">{error}</div>}

        {biometricReady && (
          <>
            <button
              className="btn primary"
              disabled={working}
              onClick={() => submit("biometric", "")}
            >
              {working && pending === "biometric"
                ? "Waiting for biometric…"
                : "Confirm with biometrics"}
            </button>
            <div className="hint center">
              An unlocked wallet is not enough on its own — every payment needs
              a biometric or your passphrase. Or use your passphrase below.
            </div>
          </>
        )}

        <div className="field">
          <label>Confirm passphrase</label>
          <input
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder="Re-enter to authorise this payment"
            autoCapitalize="none"
            autoCorrect="off"
            disabled={working}
          />
          <div className="hint">
            Required even though the wallet is unlocked — this is what stops a
            hijacked session from spending on your behalf.
          </div>
        </div>

        <div className="hint">
          Signed on this device with SIGHASH_ALL|FORKID. A broadcast transaction
          cannot be undone.
        </div>

        <div className="btn-row">
          <button className="btn ghost" onClick={onCancel} disabled={working}>
            Cancel
          </button>
          <button
            className={biometricReady ? "btn" : "btn primary"}
            onClick={() => submit("passphrase", passphrase)}
            disabled={working || passphrase.length === 0}
          >
            {working && pending === "passphrase" ? "Sending…" : "Confirm & send"}
          </button>
        </div>
      </div>
    </div>
  );
}
