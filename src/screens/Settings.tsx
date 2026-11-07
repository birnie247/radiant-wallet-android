import { useEffect, useState } from "react";
import type { ElectrumClient, NetworkName } from "@radiant-core/sdk";
import { deleteVault, unlockVault } from "../lib/vault";
import {
  addCustomServer,
  allServers,
  canonicalServerUrl,
  hiddenServers,
  parseServerUrl,
  removeServer,
  restoreHiddenServers,
  setCustomServerVerified,
  setPreferredServer,
  type ServerEntry,
} from "../lib/servers";
import { connect } from "../lib/wallet";
import { AUTO_LOCK_OPTIONS, describeAutoLock } from "../lib/autoLock";
import {
  biometricStatus,
  disableBiometricUnlock,
  enableBiometricUnlock,
  type BiometricStatus,
} from "../lib/biometric";
import { formatRxd, shortId } from "../lib/money";
import { formatUsdPrice } from "../lib/price";
import { useSecureScreen } from "../lib/useSecureScreen";
import { screenSecurityAvailable } from "../lib/screenSecurity";
import type { Nav } from "../types";

export default function Settings({ nav }: { nav: Nav }) {
  const { session } = nav;
  const network = session.secrets.network;

  const [confirmWipe, setConfirmWipe] = useState(false);
  const [revealOpen, setRevealOpen] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [revealed, setRevealed] = useState("");
  const [revealError, setRevealError] = useState("");
  const [switching, setSwitching] = useState("");
  const [bio, setBio] = useState<BiometricStatus | null>(null);
  const [bioBusy, setBioBusy] = useState(false);
  const [bioError, setBioError] = useState("");

  /**
   * The server list is user-editable, so it is read from the store rather than
   * from a constant. `hiddenCount` drives the "Restore built-in servers" button:
   * removing a curated endpoint hides it instead of destroying the default.
   */
  const [servers, setServers] = useState<ServerEntry[]>(() => allServers(network));
  const [hiddenCount, setHiddenCount] = useState(() => hiddenServers(network).length);
  const [addOpen, setAddOpen] = useState(false);
  const [removing, setRemoving] = useState<ServerEntry | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState("");
  const [serverNote, setServerNote] = useState("");
  const [serverError, setServerError] = useState("");

  function reloadServers() {
    setServers(allServers(network));
    setHiddenCount(hiddenServers(network).length);
  }

  /**
   * Canonical form of the live endpoint. `wss://host:443` and `wss://host` are
   * the same server, so the in-use marker and the "already connected" shortcut
   * must compare canonically or the badge silently disappears after a switch
   * between those two spellings.
   */
  const activeServer = canonicalServerUrl(session.endpoint);

  /**
   * `session.endpoint` is only set after a real `server.version` handshake, so
   * being connected to an unverified endpoint the user added IS the proof that it
   * works. Record the measurement once, so the "unverified" badge cannot linger
   * after a successful switch.
   */
  useEffect(() => {
    const current = allServers(network).find(
      (server) => canonicalServerUrl(server.url) === activeServer,
    );
    if (!current?.custom || current.verified) return;
    setCustomServerVerified(network, current.url, true);
    reloadServers();
  }, [network, activeServer]);

  // Screenshots / recording are blocked while the phrase sheet is open.
  const secure = useSecureScreen();

  async function openReveal() {
    await secure.hold();
    setRevealOpen(true);
  }

  async function closeReveal() {
    await secure.release();
    setRevealOpen(false);
    setRevealed("");
    setRevealError("");
    setPassphrase("");
  }

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

  const bioEnrolled = bio?.enrolled === true;

  async function toggleBiometric() {
    setBioError("");
    setBioBusy(true);
    try {
      if (bioEnrolled) {
        await disableBiometricUnlock();
      } else {
        await enableBiometricUnlock(session.secrets);
      }
    } catch (e) {
      setBioError((e as Error).message);
    } finally {
      // Always re-read the native state, even after a failure. If the stored key
      // was invalidated (a new fingerprint, or the screen lock was removed) the
      // plugin clears it, and the toggle has to fall back to "Enable" instead of
      // stranding the user with an unlock that can never succeed.
      try {
        setBio(await biometricStatus());
      } catch {
        /* keep the last known status on screen */
      }
      setBioBusy(false);
    }
  }

  async function chooseServer(url: string) {
    if (canonicalServerUrl(url) === activeServer) return;
    setSwitching(url);
    setServerError("");
    setServerNote("");
    setPreferredServer(url);
    try {
      await nav.reconnect();
      setServerNote(`Connected to ${displayName(url)}.`);
    } catch (e) {
      // Keep it visible: a failed switch leaves the wallet on the old server.
      setServerError((e as Error).message);
    } finally {
      setSwitching("");
    }
  }

  /** A server was added in the sheet: activate it only if its test passed. */
  async function handleAdded(entry: ServerEntry) {
    setAddOpen(false);
    reloadServers();
    setServerError("");
    if (!entry.verified) {
      setServerNote(
        `${displayName(entry.url)} added. Tap Use to connect to it.`,
      );
      return;
    }
    setPreferredServer(entry.url);
    setSwitching(entry.url);
    setServerNote(`${displayName(entry.url)} added and now in use.`);
    try {
      await nav.reconnect();
    } catch (e) {
      setServerError((e as Error).message);
    } finally {
      setSwitching("");
    }
  }

  async function confirmRemove() {
    if (!removing) return;
    const target = removing;
    setRemoveError("");
    setRemoveBusy(true);
    try {
      const wasActive = canonicalServerUrl(target.url) === activeServer;
      // Throws (leaving the list untouched) if this is the last server.
      removeServer(network, target.url);
      reloadServers();
      setRemoving(null);
      setServerError("");
      setServerNote(
        wasActive
          ? `${displayName(target.url)} removed — reconnecting to another server…`
          : `${displayName(target.url)} removed.`,
      );
      if (wasActive) {
        setSwitching(target.url);
        try {
          await nav.reconnect();
        } finally {
          setSwitching("");
        }
      }
    } catch (e) {
      setRemoveError((e as Error).message);
    } finally {
      setRemoveBusy(false);
    }
  }

  function restoreDefaults() {
    restoreHiddenServers(network);
    reloadServers();
    setServerError("");
    setServerNote("Built-in servers restored.");
  }

  async function reveal() {
    setRevealError("");
    try {
      const secrets = await unlockVault(passphrase);
      setRevealed(secrets.mnemonic);
      setPassphrase("");
    } catch (e) {
      setRevealError((e as Error).message);
    }
  }

  return (
    <div className="app">
      <div className="topbar">
        <button className="icon-btn" onClick={() => nav.go("home")}>
          ←
        </button>
        <h1>Settings</h1>
      </div>

      <div className="content">
        <div className="section-title">Wallet</div>
        <div className="card tight">
          <div className="row" style={{ paddingTop: 0 }}>
            <div className="grow">
              <div className="title">Network</div>
              <div className="sub">
                {network === "mainnet" ? "Radiant mainnet" : "Radiant testnet"}
              </div>
            </div>
            <span className="pill live">
              <span className="dot" /> {network}
            </span>
          </div>
          <div className="row">
            <div className="grow">
              <div className="title">Balance</div>
              <div className="sub">
                {session.scan.utxos.length} UTXO
                {session.scan.utxos.length === 1 ? "" : "s"}
              </div>
            </div>
            <div className="value">{formatRxd(session.scan.total, 8)} RXD</div>
          </div>
          <div className="row">
            <div className="grow">
              <div className="title">Next address</div>
              <div className="sub">
                {shortId(session.scan.nextReceive.address, 12, 10)}
              </div>
            </div>
            <div className="sub">{session.scan.nextReceive.path}</div>
          </div>
          <div className="row">
            <div className="grow">
              <div className="title">Connected to</div>
              <div className="sub">{session.endpoint.replace("wss://", "")}</div>
            </div>
          </div>
        </div>

        <div className="section-title">ElectrumX server</div>
        <div className="card tight">
          {servers.map((server) => {
            const active = canonicalServerUrl(server.url) === activeServer;
            const busyRow = !!switching || !!nav.busy;
            return (
              <div className="row server-row" key={server.url}>
                <div className="grow">
                  <div className="server-url">{displayName(server.url)}</div>
                  <div className="server-meta">
                    {server.custom ? "added by you" : "built in"} ·{" "}
                    {server.verified ? "verified" : "unverified"}
                    {switching === server.url ? " · connecting…" : ""}
                  </div>
                </div>
                <div className="server-actions">
                  <button
                    className={`btn small ${active ? "primary" : ""}`}
                    disabled={active || busyRow}
                    onClick={() => void chooseServer(server.url)}
                  >
                    {active ? "In use" : "Use"}
                  </button>
                  <button
                    className="btn small ghost"
                    disabled={busyRow}
                    aria-label={`Remove ${displayName(server.url)}`}
                    onClick={() => {
                      setRemoveError("");
                      setRemoving(server);
                    }}
                    style={{
                      color: "var(--danger)",
                      borderColor: "var(--danger-30)",
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
          {servers.length === 0 && (
            <div className="row">
              <div className="grow">
                <div className="title">No servers listed</div>
                <div className="sub">add one below to connect</div>
              </div>
            </div>
          )}
        </div>

        <div className="btn-row" style={{ flexWrap: "wrap" }}>
          <button
            className="btn small"
            disabled={!!switching || !!nav.busy}
            onClick={() => {
              setServerError("");
              setServerNote("");
              setAddOpen(true);
            }}
          >
            Add server
          </button>
          {hiddenCount > 0 && (
            <button className="btn small ghost" onClick={restoreDefaults}>
              Restore {hiddenCount} built-in{hiddenCount > 1 ? "s" : ""}
            </button>
          )}
        </div>

        {serverNote && <div className="notice">{serverNote}</div>}
        {serverError && <div className="error">{serverError}</div>}

        <div className="hint">
          Servers only index public chain data and never see your keys. If your
          balance looks wrong, switch servers and refresh. Removing a built-in
          server only hides it — Restore brings it back. Any server you add is
          tried only after the built-in ones unless you tap Use on it.
        </div>

        <div className="section-title">Security</div>
        <div className="stack">
          <button className="btn" onClick={nav.lock}>
            Lock wallet now
          </button>

          <div className="stack" style={{ gap: 8 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Auto-lock</div>
            <div className="btn-row" style={{ flexWrap: "wrap", gap: 8 }}>
              {AUTO_LOCK_OPTIONS.map((option) => (
                <button
                  key={option.ms}
                  className={`btn small ${
                    nav.autoLockMs === option.ms ? "primary" : ""
                  }`}
                  style={{ flex: "1 1 30%" }}
                  onClick={() => nav.setAutoLockMs(option.ms)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="hint">
              {nav.autoLockMs === 0
                ? "Locks the moment the app leaves the foreground, so coming back always asks for your biometric or passphrase."
                : `Locks ${describeAutoLock(
                    nav.autoLockMs,
                  )} in the background. Coming back after that asks for your biometric or passphrase.`}
            </div>
          </div>

          <button className="btn" onClick={() => void openReveal()}>
            Show recovery phrase
          </button>

          <button
            className="btn"
            onClick={() => nav.setAllowScreenshots(!nav.allowScreenshots)}
          >
            {nav.allowScreenshots
              ? "Block screenshots again"
              : "Allow screenshots (QR sharing)"}
          </button>
          <div className="hint">
            {nav.allowScreenshots
              ? "Screenshots are allowed app-wide, but the recovery phrase stays blocked."
              : "Screenshots and screen recording are blocked app-wide. Turn this on only when you need to share a receive address."}
          </div>

          {bio?.platform === true && bio.available ? (
            <button
              className="btn"
              onClick={toggleBiometric}
              disabled={bioBusy}
            >
              {bioBusy
                ? "Waiting for biometric…"
                : bioEnrolled
                  ? "Disable biometric unlock"
                  : "Enable biometric unlock"}
            </button>
          ) : (
            <div className="hint">
              {bio?.reason ||
                "Biometric unlock is only available in the Android app."}
            </div>
          )}

          {bioEnrolled && (
            <div className="hint">
              Your wallet secret is encrypted by a hardware key in the Android
              Keystore that requires a strong biometric for every use. Enrolling
              a new fingerprint invalidates the key and disables biometric
              unlock. While it is enabled, sending RXD also asks for your
              biometric — or your passphrase — before anything is signed.
            </div>
          )}

          {bioError && <div className="error">{bioError}</div>}
        </div>

        <div className="section-title">Display</div>
        <div className="stack">
          <button
            className="btn"
            onClick={() => nav.setFiatEnabled(!nav.fiatEnabled)}
          >
            {nav.fiatEnabled ? "Hide USD value" : "Show USD value"}
          </button>
          <div className="hint">
            {nav.fiatEnabled
              ? `Price from ${nav.price?.source ?? "a public price API"}${
                  nav.price ? `: ${formatUsdPrice(nav.price.usd)} per RXD` : " — unavailable right now"
                }${nav.price?.stale ? " (cached)" : ""}. Requests go to the price provider, which sees your IP address.`
              : "Fiat values are hidden and no price requests are made."}
          </div>
        </div>

        <div className="section-title">Danger zone</div>
        {confirmWipe ? (
          <div className="danger-zone stack">
            <div style={{ fontSize: 13 }}>
              This deletes the encrypted wallet from this device. Without your
              written recovery phrase the funds are gone forever.
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
                onClick={async () => {
                  // Drop the Keystore-wrapped copy too, so a deleted wallet
                  // cannot be reopened through the biometric prompt.
                  await disableBiometricUnlock();
                  deleteVault();
                  window.location.reload();
                }}
              >
                Delete forever
              </button>
            </div>
          </div>
        ) : (
          <button className="btn danger" onClick={() => setConfirmWipe(true)}>
            Delete wallet from this device
          </button>
        )}

        <div className="section-title">About</div>
        <div className="card tight">
          <div className="row" style={{ paddingTop: 0 }}>
            <div className="grow">
              <div className="title">Radiant Wallet</div>
              <div className="sub">v{__APP_VERSION__} · non-custodial</div>
            </div>
          </div>
          <div className="row">
            <div className="grow">
              <div className="title">Derivation</div>
              <div className="sub">BIP44 m/44'/512'/account'/change/index</div>
            </div>
          </div>
          <div className="row">
            <div className="grow">
              <div className="title">Address type</div>
              <div className="sub">P2PKH base58 (Radiant has no SegWit)</div>
            </div>
          </div>
        </div>
      </div>

      {addOpen && (
        <AddServerSheet
          network={network}
          onClose={() => setAddOpen(false)}
          onAdded={(entry) => void handleAdded(entry)}
        />
      )}

      {removing && (
        <div className="sheet-backdrop" onClick={() => setRemoving(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 17 }}>Remove server?</div>
            <div className="server-url">{displayName(removing.url)}</div>
            <div className="hint">
              {removing.custom
                ? "You added this server, so removing it deletes it from the list."
                : "This is a built-in server. Removing it hides it — Restore built-in servers brings it back."}
              {canonicalServerUrl(removing.url) === activeServer
                ? " It is the server you are connected to, so the wallet will reconnect to another one."
                : ""}
            </div>
            {removeError && <div className="error">{removeError}</div>}
            <div className="btn-row">
              <button
                className="btn ghost"
                disabled={removeBusy}
                onClick={() => setRemoving(null)}
              >
                Cancel
              </button>
              <button
                className="btn danger"
                disabled={removeBusy}
                onClick={() => void confirmRemove()}
              >
                {removeBusy ? "Removing…" : "Remove"}
              </button>
            </div>
          </div>
        </div>
      )}

      {revealOpen && (
        <RevealSheet
          revealed={revealed}
          passphrase={passphrase}
          setPassphrase={setPassphrase}
          error={revealError}
          onReveal={reveal}
          onClose={() => void closeReveal()}
        />
      )}
    </div>
  );
}

function RevealSheet({
  revealed,
  passphrase,
  setPassphrase,
  error,
  onReveal,
  onClose,
}: {
  revealed: string;
  passphrase: string;
  setPassphrase: (v: string) => void;
  error: string;
  onReveal: () => void;
  onClose: () => void;
}) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div style={{ fontWeight: 700, fontSize: 17 }}>
          {revealed ? "Your recovery phrase" : "Confirm passphrase"}
        </div>

        {revealed ? (
          <>
            <div className="card tight" style={{ background: "var(--bg)" }}>
              <div className="seed-grid">
                {revealed.split(" ").map((w, i) => (
                  <div className="seed-word" key={`${w}-${i}`}>
                    <i>{i + 1}</i>
                    {w}
                  </div>
                ))}
              </div>
            </div>
            <div className="notice">
              Anyone with these words can spend your RXD. Never photograph them
              or type them into a website.
            </div>
            {screenSecurityAvailable() && (
              <div className="hint">
                Screenshots and screen recording are blocked while this phrase is
                on screen.
              </div>
            )}
            <button className="btn" onClick={onClose}>
              Close
            </button>
          </>
        ) : (
          <>
            <div className="field">
              <label>Passphrase</label>
              <input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
              />
            </div>
            {error && <div className="error">{error}</div>}
            <div className="btn-row">
              <button className="btn ghost" onClick={onClose}>
                Cancel
              </button>
              <button
                className="btn primary"
                onClick={onReveal}
                disabled={passphrase.length === 0}
              >
                Reveal
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** `wss://host:port` -> `host:port`, for display only. */
function displayName(url: string): string {
  return url.replace(/^wss:\/\//, "");
}

/** `["ElectrumX 1.3.0", "1.4"]` -> `ElectrumX 1.3.0`. */
function describeVersion(raw: unknown): string {
  if (Array.isArray(raw) && typeof raw[0] === "string") return raw[0];
  return typeof raw === "string" ? raw : "";
}

/**
 * Add a user-supplied ElectrumX endpoint.
 *
 * "Test" is not decoration: the store records `verified` from a real
 * `server.version` handshake, and only a verified server is activated
 * automatically. An untested server is still added, but left inactive, so a typo
 * cannot silently take over the wallet's connection.
 */
function AddServerSheet({
  network,
  onClose,
  onAdded,
}: {
  network: NetworkName;
  onClose: () => void;
  onAdded: (entry: ServerEntry) => void;
}) {
  const [input, setInput] = useState("");
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; detail: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const busy = testing || saving;

  async function testConnection() {
    const parsed = parseServerUrl(input);
    if ("error" in parsed) {
      setTest(null);
      setError(parsed.error);
      return;
    }
    setError("");
    setTest(null);
    setTesting(true);
    const startedAt = Date.now();
    let client: ElectrumClient | undefined;
    try {
      const connection = await connect(network, parsed.url, undefined, {
        // Exactly one candidate: this tests THAT server, not the pool.
        candidates: [parsed.url],
        budgetMs: 12_000,
        connectTimeoutMs: 8_000,
        handshakeTimeoutMs: 4_000,
      });
      client = connection.client;
      // The banner comes from the handshake connect() already performed; asking
      // again would be rejected by ElectrumX as a duplicate server.version.
      const banner = describeVersion(connection.serverVersion);
      setTest({
        ok: true,
        detail: `${banner || "Handshake completed"} in ${Date.now() - startedAt} ms`,
      });
    } catch (e) {
      setTest({ ok: false, detail: (e as Error).message });
    } finally {
      try {
        client?.close();
      } catch {
        /* ignore */
      }
      setTesting(false);
    }
  }

  function save() {
    const parsed = parseServerUrl(input);
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }
    setError("");
    setSaving(true);
    try {
      onAdded(
        addCustomServer(network, parsed.url, { verified: test?.ok === true }),
      );
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  return (
    <div className="sheet-backdrop" onClick={busy ? undefined : onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div style={{ fontWeight: 700, fontSize: 17 }}>Add ElectrumX server</div>

        <div className="field">
          <label>Server address</label>
          <input
            className="mono"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setTest(null);
              setError("");
            }}
            placeholder="wss://electrumx.example.org:50022"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            inputMode="url"
          />
          <div className="hint">
            wss:// only, on the hostname — a certificate cannot prove a bare IP.
            Typing just <span className="mono">electrumx.example.org:50022</span>{" "}
            is treated as wss://.
          </div>
        </div>

        {test?.ok && <div className="success-box">{test.detail}</div>}
        {test && !test.ok && <div className="error">{test.detail}</div>}
        {error && <div className="error">{error}</div>}

        <button
          className="btn"
          disabled={busy || input.trim().length === 0}
          onClick={() => void testConnection()}
        >
          {testing ? "Testing…" : "Test connection"}
        </button>

        <div className="btn-row">
          <button className="btn ghost" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={busy || input.trim().length === 0}
            onClick={save}
          >
            {saving ? "Adding…" : test?.ok ? "Add and use" : "Add"}
          </button>
        </div>

        <div className="hint">
          {test?.ok
            ? "The handshake passed, so this server is used straight away."
            : "Without a test the server is added but not activated — tap Use on its row to switch to it."}
        </div>
      </div>
    </div>
  );
}
