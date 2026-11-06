import { useCallback, useEffect, useRef, useState } from "react";
import { HDWallet } from "@radiant-core/sdk";
import { hasVault, unlockVault, type WalletSecrets } from "./lib/vault";
import { connect, crossCheckTip, scanWallet } from "./lib/wallet";
import { getPreferredServer } from "./lib/servers";
import { loadHistory, type HistoryEntry } from "./lib/history";
import {
  fetchRxdUsd,
  loadFiatEnabled,
  saveFiatEnabled,
  type PriceResult,
} from "./lib/price";
import { unlockWithBiometric } from "./lib/biometric";
import { loadAutoLockMs, saveAutoLockMs } from "./lib/autoLock";
import { useAutoLock } from "./lib/useAutoLock";
import {
  acquireSecureScreen,
  releaseSecureScreen,
} from "./lib/screenSecurity";
import type { Screen, Session } from "./types";
import BrandMark from "./components/BrandMark";
import Onboarding from "./screens/Onboarding";
import Unlock from "./screens/Unlock";
import Home from "./screens/Home";
import Receive from "./screens/Receive";
import Send from "./screens/Send";
import Settings from "./screens/Settings";

/** L1: screenshots are blocked app-wide unless the user opts out. */
const ALLOW_SCREENSHOTS_KEY = "rxd.security.allowScreenshots";

export default function App() {
  const [booted, setBooted] = useState(false);
  const [hasExisting, setHasExisting] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [screen, setScreen] = useState<Screen>("home");
  const [busy, setBusy] = useState("");
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [tipDrift, setTipDrift] = useState<number | null>(null);
  const [allowScreenshots, setAllowScreenshotsState] = useState<boolean>(() => {
    try {
      return localStorage.getItem(ALLOW_SCREENSHOTS_KEY) === "1";
    } catch {
      return false;
    }
  });

  /** How long the app may sit in the background before it locks itself. */
  const [autoLockMs, setAutoLockMsState] = useState<number>(loadAutoLockMs);

  /** RXD/USD price for display. Null when unavailable or fiat is switched off. */
  const [price, setPrice] = useState<PriceResult | null>(null);
  const [fiatEnabled, setFiatEnabledState] = useState<boolean>(loadFiatEnabled);

  const setFiatEnabled = useCallback((enabled: boolean) => {
    setFiatEnabledState(enabled);
    saveFiatEnabled(enabled);
    // Switching it off must also stop the requests immediately.
    if (!enabled) setPrice(null);
    else void fetchRxdUsd().then(setPrice).catch(() => undefined);
  }, []);

  const hydratePrice = useCallback(async () => {
    if (!fiatEnabled) {
      setPrice(null);
      return;
    }
    // Never throws: a price API being down must not affect the wallet.
    setPrice(await fetchRxdUsd());
  }, [fiatEnabled]);

  const setAutoLockMs = useCallback((ms: number) => {
    setAutoLockMsState(ms);
    saveAutoLockMs(ms);
  }, []);

  const setAllowScreenshots = useCallback((allow: boolean) => {
    setAllowScreenshotsState(allow);
    try {
      localStorage.setItem(ALLOW_SCREENSHOTS_KEY, allow ? "1" : "0");
    } catch {
      /* ignore storage failure */
    }
  }, []);

  const sessionRef = useRef<Session | null>(null);
  sessionRef.current = session;

  useEffect(() => {
    setHasExisting(hasVault());
    setBooted(true);
  }, []);

  /**
   * Load confirmation-annotated history in the background.
   * Deliberately non-blocking: the wallet is usable before this resolves, and a
   * server that refuses to serve history must not stop the user spending.
   */
  const hydrateHistory = useCallback(async (next: Session) => {
    setHistory(null);
    setTipDrift(null);
    try {
      const result = await loadHistory(next.client, next.scan.addresses, {
        limit: 25,
      });
      setHistory(result.entries);
      setHistoryTotal(result.totalKnown);

      // MEDIUM-2: confirm the primary server's tip against an independent
      // operator. Best effort — a wallet must stay usable if it fails.
      const other = await crossCheckTip(next.secrets.network, next.endpoint);
      if (other) {
        setTipDrift(Math.abs(result.tipHeight - other.height));
      }
    } catch {
      setHistory([]);
      setHistoryTotal(0);
    }
  }, []);

  /** Connect, scan, and hold the wallet in memory. */
  const openWallet = useCallback(async (secrets: WalletSecrets) => {
    setBusy("Connecting to a Radiant server…");
    try {
      const { client, endpoint } = await connect(
        secrets.network,
        secrets.server || getPreferredServer() || undefined,
        (url) => setBusy(`Connecting to ${url.replace("wss://", "")}…`),
      );

      const wallet = HDWallet.fromMnemonic(secrets.mnemonic, {
        network: secrets.network,
      });

      setBusy("Scanning the blockchain…");
      const scan = await scanWallet(client, wallet, {
        onProgress: setBusy,
      });

      setSession({ secrets, wallet, client, endpoint, scan });
      setScreen("home");
      void hydrateHistory({ secrets, wallet, client, endpoint, scan });
      void hydratePrice();
    } finally {
      setBusy("");
    }
  }, [hydrateHistory, hydratePrice]);

  /** Re-scan balances against the live connection. */
  const refresh = useCallback(async () => {
    const current = sessionRef.current;
    if (!current) return;
    setBusy("Refreshing…");
    try {
      const scan = await scanWallet(current.client, current.wallet, {
        onProgress: setBusy,
      });
      const next = { ...current, scan };
      setSession(next);
      void hydrateHistory(next);
      void hydratePrice();
    } finally {
      setBusy("");
    }
  }, [hydrateHistory, hydratePrice]);

  /** Drop the socket and reconnect, optionally to a newly preferred server. */
  const reconnect = useCallback(async () => {
    const current = sessionRef.current;
    if (!current) return;
    setBusy("Reconnecting…");
    try {
      current.client.close();
    } catch {
      /* ignore */
    }
    try {
      const { client, endpoint } = await connect(
        current.secrets.network,
        getPreferredServer() || undefined,
        (url) => setBusy(`Connecting to ${url.replace("wss://", "")}…`),
      );
      const scan = await scanWallet(client, current.wallet, {
        onProgress: setBusy,
      });
      const next = { ...current, client, endpoint, scan };
      setSession(next);
      void hydrateHistory(next);
      void hydratePrice();
    } finally {
      setBusy("");
    }
  }, [hydrateHistory, hydratePrice]);

  const lock = useCallback(() => {
    const current = sessionRef.current;
    if (current) {
      try {
        current.client.close();
      } catch {
        /* ignore */
      }
    }
    setSession(null);
    setScreen("home");
    setHasExisting(hasVault());
    setHistory(null);
    setHistoryTotal(0);
  }, []);

  // Auto-lock: the wallet locks itself as soon as the app leaves the foreground
  // (or after a grace period, if the user has chosen one in Settings). Coming
  // back therefore always lands on the Unlock screen, which offers the biometric
  // prompt or the passphrase — the decrypted mnemonic does not survive the trip.
  useAutoLock({
    enabled: session !== null,
    thresholdMs: autoLockMs,
    onLock: lock,
  });

  // L1: block screenshots/screen recording app-wide, not only on seed screens.
  // The refcount in screenSecurity.ts means seed screens stay protected even
  // when the user has opted out here (for sharing a receive QR, say).
  useEffect(() => {
    if (allowScreenshots) return;
    void acquireSecureScreen();
    return () => {
      void releaseSecureScreen();
    };
  }, [allowScreenshots]);

  // Tear the socket down on unmount.
  useEffect(() => {
    return () => {
      try {
        sessionRef.current?.client.close();
      } catch {
        /* ignore */
      }
    };
  }, []);

  if (!booted) {
    return <Splash />;
  }

  if (!session) {
    if (busy) return <Splash message={busy} />;
    return hasExisting ? (
      <Unlock
        onUnlock={async (passphrase) => {
          const secrets = await unlockVault(passphrase);
          await openWallet(secrets);
        }}
        onBiometricUnlock={async () => {
          const secrets = await unlockWithBiometric();
          await openWallet(secrets);
        }}
      />
    ) : (
      <Onboarding
        onReady={async (secrets) => {
          await openWallet(secrets);
          setHasExisting(true);
        }}
      />
    );
  }

  const nav = {
    session,
    go: setScreen,
    refresh,
    lock,
    reconnect,
    busy,
    history,
    historyTotal,
    tipDrift,
    allowScreenshots,
    setAllowScreenshots,
    autoLockMs,
    setAutoLockMs,
    price,
    fiatEnabled,
    setFiatEnabled,
  };

  return (
    <>
      {screen === "home" && <Home nav={nav} />}
      {screen === "receive" && <Receive nav={nav} />}
      {screen === "send" && <Send nav={nav} />}
      {screen === "settings" && <Settings nav={nav} />}
      {busy && (
        <div className="sheet-backdrop">
          <div className="sheet center">
            <div className="spin" />
            <div style={{ color: "var(--text-dim)", fontSize: 13 }}>{busy}</div>
          </div>
        </div>
      )}
    </>
  );
}

function Splash({ message }: { message?: string }) {
  return (
    <div className="app">
      <div className="splash">
        <BrandMark />
        <div>
          <div style={{ fontWeight: 700, fontSize: 20 }}>Radiant Wallet</div>
          <div style={{ color: "var(--text-faint)", fontSize: 13 }}>
            Non-custodial · RXD
          </div>
        </div>
        {message ? (
          <div style={{ color: "var(--text-dim)", fontSize: 13, maxWidth: 300 }}>
            {message}
          </div>
        ) : (
          <div className="spin" />
        )}
      </div>
    </div>
  );
}
