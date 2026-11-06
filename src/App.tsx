import { useCallback, useEffect, useRef, useState } from "react";
import { HDWallet } from "@radiant-core/sdk";
import { hasVault, unlockVault, type WalletSecrets } from "./lib/vault";
import { connect, crossCheckTip, scanWallet } from "./lib/wallet";
import { getPreferredServer } from "./lib/servers";
import { loadHistory, type HistoryEntry } from "./lib/history";
import { syncChain, verifyTransaction, type ChainResult } from "./lib/spv";
import { watchWalletAddresses, type WatchHandle } from "./lib/liveUpdates";
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
  /**
   * Result of verifying the header chain (see src/lib/spv.ts). Null until the first
   * attempt finishes; `ok` false carries the reason.
   */
  const [spv, setSpv] = useState<ChainResult | null>(null);
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

  /** When the chain was last verified, so the 60 s poll does not redo it. */
  const lastSpvAtRef = useRef(0);

  /**
   * SPV: verify the header chain from the pinned checkpoint, then prove that each
   * confirmed transaction we are displaying really sits in one of those blocks.
   *
   * Background work, never blocking spending. A failed proof is recorded rather than
   * thrown: the wallet stays usable, but the row stops claiming to be verified,
   * which is the honest outcome if a server is lying.
   */
  const verifySpv = useCallback(
    async (next: Session, entries: HistoryEntry[]) => {
      // The backstop poll reloads history every minute; re-proving the same headers
      // that often is wasted work.
      if (Date.now() - lastSpvAtRef.current < 5 * 60_000) return;

      let chain: ChainResult;
      try {
        chain = await syncChain(next.client);
      } catch (e) {
        setSpv({
          ok: false,
          tip: 0,
          tipHash: "",
          checked: 0,
          reason: (e as Error).message || "header verification failed",
          merkleRoots: new Map(),
        });
        return;
      }
      setSpv(chain);
      if (!chain.ok) return;
      lastSpvAtRef.current = Date.now();

      // Each proof costs a round trip, so bound the work.
      const confirmed = entries.filter((entry) => entry.height > 0).slice(0, 8);
      if (confirmed.length === 0) return;

      const proofs = await Promise.all(
        confirmed.map(async (entry) => {
          try {
            const proof = await verifyTransaction(
              next.client,
              entry.txid,
              entry.height,
              chain.merkleRoots,
            );
            return [entry.txid, proof] as const;
          } catch {
            return [
              entry.txid,
              { verified: false, reason: "proof request failed", height: entry.height },
            ] as const;
          }
        }),
      );
      const byTxid = new Map(proofs);
      setHistory((current) =>
        (current ?? []).map((entry) => {
          const proof = byTxid.get(entry.txid);
          return proof
            ? { ...entry, verified: proof.verified, verifyNote: proof.reason || undefined }
            : entry;
        }),
      );
    },
    [lastSpvAtRef],
  );

  /**
   * Load confirmation-annotated history in the background, then verify it.
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

      // SPV, with the entries just loaded (passing them in avoids racing state).
      await verifySpv(next, result.entries);
    } catch {
      setHistory([]);
      setHistoryTotal(0);
    }
  }, [verifySpv]);

  /** One scan at a time; push notifications arrive in bursts. */
  const scanningRef = useRef(false);
  /** Active push subscriptions for this unlocked session. */
  const watchRef = useRef<WatchHandle | null>(null);
  /** Indirection so the watcher can trigger the newest runScan without a cycle. */
  const onPushRef = useRef<() => void>(() => {});

  /**
   * Replace the push subscriptions for the current address set.
   *
   * Push is an optimisation, not the only way balances update: if the server
   * refuses a subscription (some cap them) the backstop poll still runs.
   */
  const establishWatch = useCallback(async (next: Session) => {
    try {
      await watchRef.current?.dispose();
    } catch {
      /* ignore */
    }
    watchRef.current = null;
    try {
      watchRef.current = await watchWalletAddresses(
        next.client,
        next.scan.addresses,
        () => onPushRef.current(),
      );
    } catch {
      /* ignore — the poll covers it */
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

      const next: Session = { secrets, wallet, client, endpoint, scan };
      setSession(next);
      setScreen("home");
      void hydrateHistory(next);
      void hydratePrice();
      // Subscribe to pushes so the balance keeps itself current.
      void establishWatch(next);
    } finally {
      setBusy("");
    }
  }, [hydrateHistory, hydratePrice, establishWatch]);

  /**
   * Re-scan balances against the live connection.
   *
   * `silent` runs it in the background: no "Refreshing…" overlay, no busy text.
   * That path is used by server push notifications and the backstop poll, so an
   * incoming payment never interrupts whatever the user is doing.
   */
  const runScan = useCallback(
    async (silent: boolean) => {
      const current = sessionRef.current;
      // One scan at a time: pushes can arrive in bursts, and overlapping scans
      // would fight over the session.
      if (!current || scanningRef.current) return;
      scanningRef.current = true;
      if (!silent) setBusy("Refreshing…");
      try {
        const scan = await scanWallet(current.client, current.wallet, {
          onProgress: silent ? undefined : setBusy,
        });
        const next = { ...current, scan };
        setSession(next);
        void hydrateHistory(next);
        void hydratePrice();
        // The set of addresses with activity can grow, so re-subscribe.
        void establishWatch(next);
      } finally {
        scanningRef.current = false;
        if (!silent) setBusy("");
      }
    },
    [hydrateHistory, hydratePrice, establishWatch],
  );

  /** User-initiated refresh (Home screen button, after a send). */
  const refresh = useCallback(() => runScan(false), [runScan]);

  // A push notification means "something changed": scan quietly, no overlay.
  useEffect(() => {
    onPushRef.current = () => void runScan(true);
  }, [runScan]);

  // Backstop poll. Pushes normally arrive within a second, but a server that
  // does not push — or a socket that died silently — would otherwise leave the
  // balance stale until the user tapped Refresh. Deliberately gentle (60s) and
  // only while the app is actually on screen.
  const hasSession = session !== null;
  useEffect(() => {
    if (!hasSession) return;
    const POLL_MS = 60_000;
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void runScan(true);
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [hasSession, runScan]);

  /** Drop the socket and reconnect, optionally to a newly preferred server. */
  const reconnect = useCallback(async () => {
    const current = sessionRef.current;
    if (!current) return;
    setBusy("Reconnecting…");
    try {
      await watchRef.current?.dispose();
    } catch {
      /* ignore */
    }
    watchRef.current = null;
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
      void establishWatch(next);
    } finally {
      setBusy("");
    }
  }, [hydrateHistory, hydratePrice, establishWatch]);

  const lock = useCallback(() => {
    const current = sessionRef.current;
    // Stop push subscriptions before the socket goes away, so nothing tries to
    // unsubscribe over a closed connection.
    void watchRef.current?.dispose();
    watchRef.current = null;
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
      void watchRef.current?.dispose();
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
    spv: spv
      ? { ok: spv.ok, tip: spv.tip, checked: spv.checked, reason: spv.reason }
      : null,
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
