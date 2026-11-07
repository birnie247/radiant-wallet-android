/**
 * ElectrumX endpoints for Radiant.
 *
 * Transport: the Radiant SDK speaks ElectrumX over **WebSocket** JSON-RPC, so
 * every endpoint below is `wss://` AND on a WebSocket port. The two are easy to
 * confuse. On 2026-11-06 `electrumx.radiantcore.org` answered `server.version`
 * on :50012 over raw TLS + line protocol, while :50001/:50002/:50003/:50004/
 * :50022 were all closed on it — and the *usable* endpoint turned out to be
 * `wss://electrumx.radiantcore.org:443`. A host that "answers on 50012" is
 * therefore not automatically usable here: a browser/Capacitor WebSocket cannot
 * speak the line protocol, it fails the HTTP upgrade.
 *
 * The historical 50001/50002 hosts (`electrum.radiant.ovh`,
 * `electrum.radiantblockchain.org`) are dead — neither hostname resolves — and
 * `electrumx.radiant.ovh`, `electrumx.radiantexplorer.com` and
 * `electrumx2.radiantexplorer.com` no longer serve a WebSocket port. Do not
 * reintroduce any of them.
 *
 * Trust model (security report MEDIUM-2):
 *   • Every endpoint is `wss://` with a hostname, so the TLS certificate is
 *     actually verifiable. A bare-IP endpoint was REMOVED: an IP cannot match a
 *     certificate's identity, which silently degrades to "trust the network".
 *   • `operator` groups endpoints that share an administrator. Cross-checking
 *     two servers from the same operator proves nothing, so quorum logic
 *     (see crossCheckTip in wallet.ts) only counts distinct operators.
 *   • `verified` is not a UI label — connect() tries verified servers first and
 *     only falls back to unverified ones. Both flags describe the node operator,
 *     not the chain.
 *
 * What this still does NOT do: full SPV. A server can lie about history or
 * confirmations, and this client does not verify merkle proofs against block
 * headers or check proof-of-work. It only cross-checks the chain tip between
 * independent operators, which detects gross disagreement/staleness. Treat the
 * Electrum server as a semi-trusted view of the chain.
 */
import type { NetworkName } from "@radiant-core/sdk";

export interface ServerEntry {
  url: string;
  /** Administrator grouping; quorum requires distinct operators. */
  operator: string;
  /**
   * True only for endpoints that answered a live `server.version` handshake.
   * These are the ones `connect()` will try on its own — see autoCandidates().
   */
  verified: boolean;
}

/**
 * Last live probe: 2026-11-06 (`npm run probe`). All three mainnet endpoints
 * below completed a `server.version` handshake and reported Radiant's genesis
 * hash, with tips of 479,536 / 479,536 / 479,538 — the radiantcore.org peer was
 * two blocks ahead, so none of them is stale.
 *
 * Removed on 2026-11-06:
 *   • `radiant2/radiantus/radiant4.bladenet.online:50022` — all three timed out.
 *   • `wss://radiantcore.org:50004` — that host serves WebSocket on :443 only;
 *     :50004 has no listener.
 *
 * Re-check with `npm run probe`. If a listed endpoint dies, flag it
 * `verified: false` instead of deleting it: it drops out of the automatic connect
 * order (see autoCandidates) but stays selectable in Settings, so a dead host can
 * never add ~7s of silence to every connection attempt.
 */
export const SERVERS: Record<NetworkName, ServerEntry[]> = {
  mainnet: [
    {
      url: "wss://electrumx.radiant4people.com:50022",
      operator: "radiant4people.com",
      verified: true,
    },
    {
      url: "wss://electrumx2.radiant4people.com:50022",
      operator: "radiant4people.com",
      verified: true,
    },
    {
      url: "wss://electrumx.radiantcore.org:443",
      operator: "radiantcore.org",
      verified: true,
    },
    // NOTE: the bare-IP endpoint wss://82.180.136.182:50004 was removed (see
    // the trust-model note above). That IP is still current — it is what both
    // radiantcore.org and electrumx.radiantcore.org resolve to — but only the
    // hostname form has a certificate that can actually be verified.
    // The three *.bladenet.online endpoints were removed on 2026-11-06: all of
    // them timed out, and they were never verified.
  ],
  // Testnet support was removed: every testnet endpoint is gone.
  // electrumx-testnet.radiant4people.com refuses connections and
  // testnet.bladenet.online no longer resolves, so offering the network only
  // produced a confusing failure. The wallet is mainnet-only.
  testnet: [],
  regtest: [],
};

export function serverList(network: NetworkName): string[] {
  return SERVERS[network].map((s) => s.url);
}

export function findServer(
  network: NetworkName,
  url: string,
): ServerEntry | undefined {
  return SERVERS[network].find((s) => s.url === url);
}

/**
 * Ordered candidates for the Settings list and for probing: everything we know
 * about, verified endpoints first. `connect()` uses {@link autoCandidates}
 * instead, which omits the dead ones.
 */
export function candidateServers(
  network: NetworkName,
  preferred?: string,
): string[] {
  const all = SERVERS[network];
  const ordered = [
    ...all.filter((s) => s.verified),
    ...all.filter((s) => !s.verified),
  ];
  const urls = ordered.map((s) => s.url);
  if (!preferred) return urls;
  return [preferred, ...urls.filter((u) => u !== preferred)];
}

/**
 * Endpoints worth trying automatically, in order: the user's explicit choice
 * (they may have picked a host we consider unverified), then the verified ones.
 *
 * If a network has NO verified endpoint at all the whole list is used, because a
 * slow failure is better than refusing to try. With testnet removed that branch
 * is effectively unreachable today, but it keeps the behaviour sane if every
 * endpoint on a network is ever downgraded at once.
 */
export function autoCandidates(
  network: NetworkName,
  preferred?: string,
): string[] {
  const all = SERVERS[network];
  const verified = all.filter((s) => s.verified).map((s) => s.url);
  const pool = verified.length > 0 ? verified : all.map((s) => s.url);
  if (!preferred) return pool;
  return [preferred, ...pool.filter((u) => u !== preferred)];
}

/**
 * Endpoints run by a DIFFERENT operator than `endpoint` — the only ones useful
 * for an independent cross-check. Verified endpoints are ordered first, but
 * unverified ones are included: a cross-check only compares chain heights, it
 * never trusts the peer's data. Including them means the check can still detect
 * disagreement when the curated peers are offline. If every candidate is down
 * the check simply returns null and no warning is shown (better than a false
 * alarm).
 */
export function independentServers(
  network: NetworkName,
  endpoint: string,
): ServerEntry[] {
  const primary = findServer(network, endpoint);
  const others = SERVERS[network].filter(
    (s) => s.url !== endpoint && s.operator !== primary?.operator,
  );
  return [
    ...others.filter((s) => s.verified),
    ...others.filter((s) => !s.verified),
  ];
}

/**
 * The user's chosen server is NOT a secret, so it lives outside the encrypted
 * vault — that way switching servers never requires the passphrase.
 */
const PREFERRED_KEY = "rxd.wallet.preferredServer";

export function getPreferredServer(): string | null {
  try {
    return localStorage.getItem(PREFERRED_KEY);
  } catch {
    return null;
  }
}

export function setPreferredServer(url: string): void {
  try {
    if (url) localStorage.setItem(PREFERRED_KEY, url);
    else localStorage.removeItem(PREFERRED_KEY);
  } catch {
    /* storage may be unavailable in private mode */
  }
}
