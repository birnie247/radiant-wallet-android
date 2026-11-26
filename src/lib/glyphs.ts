/**
 * Glyph token data layer: discovery, balances and metadata.
 *
 * Wire protocol facts below were pinned EMPIRICALLY by scripts/probe-glyphs.mjs
 * against wss://rxdexplorer.com (ElectrumX 1.4.1) on 2026-11-26 — do not
 * "correct" them from documentation alone:
 *
 * 1. DISCOVERY. Token outputs are indexed under the scripthash of their script
 *    with the 36-byte ref operand ZEROED. To find an address's tokens, query
 *    listunspent for scriptHash(zeroRefs(nftScript(addr, ZERO_REF))) and the
 *    ftScript variant. The zeroed-FT form is the P2PKH-prefixed covenant
 *    (76a914…88ac bd d0 <ref> de c0e9aa…), NOT a bare d0 script.
 *
 * 2. REF FORMATS differ per RPC. listunspent reports refs as
 *    "<display txid>i<vout>" (and type "single" for NFTs); blockchain.ref.get
 *    only resolves "<display txid><4-byte BIG-endian vout hex>" — the packed
 *    little-endian packRef form returns an empty list. unpackRef/packRef are
 *    therefore for ON-CHAIN script operands, never for ref.get arguments.
 *
 * 3. METADATA. The reveal transaction MAY carry a `03 67 6c 79` ("gly") push
 *    followed by a CBOR payload in an input scriptSig — but bare mints omit it
 *    entirely (probe: 5eeb0648… has no envelope). Absence is normal, not an
 *    error. Payload shape (probe: "Fabled Longbow"):
 *    { v, p: [protocolIds], name, desc, attrs, main: { t: mime, b: bytes } }.
 *
 * Safety invariants:
 *   • Every TokenUtxo script is REBUILT from (address, ref) and must hash back
 *    to the zeroed scripthash we queried — a lying server cannot sneak us a
 *    foreign script to sign later.
 *   • Decoded CBOR is size-capped and icons are limited to raster MIME types
 *    rendered via data: URI. SVG/markup is a WebView XSS surface and is
 *    dropped here, at the boundary, not in the UI.
 *   • Identity is the REF, never name/ticker — two tokens can share a string.
 */
import {
  ftScript,
  nftScript,
  packRef,
  parseFtScript,
  parseNftScript,
  parseP2pkhScript,
  p2pkhScript,
  scriptHash,
  tokenScriptKind,
  zeroRefs,
  type ElectrumClient,
  type Utxo,
} from "@radiant-core/sdk";
import { decode as cborDecode } from "cbor-x";
import type { ScannedAddress } from "./wallet";

/** 36 zero bytes — the wildcard ref the indexer keys token scripts under. */
export const ZERO_REF = "00".repeat(36);

export type TokenKind = "ft" | "nft";

export interface TokenUtxo {
  txid: string;
  vout: number;
  value: bigint;
  height?: number;
  /** On-chain token script, rebuilt locally and scripthash-verified. */
  script: string;
  /** Packed 72-hex ref (on-chain operand form). */
  ref: string;
  /** Display ref "txid:vout" — the token's identity key everywhere in the UI. */
  refDisplay: string;
  kind: TokenKind;
  ownerAddress: string;
  ownerWif: string;
  ownerIndex: number;
  ownerChange: number;
}

export interface GlyphMetadata {
  name?: string;
  ticker?: string;
  description?: string;
  /** Glyph protocol ids from the payload's `p` field (1=FT, 2=NFT, 5=mutable…). */
  protocols: number[];
  attrs?: Record<string, unknown>;
  /** data: URI for a raster icon only (png/jpeg/gif/webp), size-capped. */
  iconDataUri?: string;
}

export interface TokenBalance {
  ref: string;
  refDisplay: string;
  kind: TokenKind;
  /** FT: token amount in base units (== summed photons). NFT: 1n. */
  amount: bigint;
  /** RXD photons riding on these UTXOs — locked, not spendable as plain RXD. */
  lockedPhotons: bigint;
  utxos: TokenUtxo[];
  metadata?: GlyphMetadata;
}

export interface TokenScanResult {
  tokens: TokenBalance[];
  utxos: TokenUtxo[];
  lockedPhotons: bigint;
}

/** Run `fn` over `items` with bounded concurrency (mirrors wallet.ts). */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (true) {
        const i = cursor++;
        if (i >= items.length) return;
        results[i] = await fn(items[i], i);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

/* ------------------------------------------------------------ refs ------ */

/**
 * Parse the ref formats servers actually send: listunspent's "txid{i}vout",
 * plus the "txid:vout" and "txid_vout" spellings used by the REST API.
 * Returns null for anything else (including packed 72-hex — use unpackRef).
 */
export function parseServerRef(
  ref: string,
): { txid: string; vout: number } | null {
  const m = ref
    .trim()
    .toLowerCase()
    .match(/^([0-9a-f]{64})[:i_](\d{1,10})$/);
  if (!m) return null;
  const vout = Number(m[2]);
  return Number.isSafeInteger(vout) ? { txid: m[1], vout } : null;
}

/**
 * blockchain.ref.get argument: display-order txid concatenated with the vout
 * as 4-byte BIG-endian hex. Pinned by probe-glyphs.mjs — the little-endian
 * packRef form resolves to an empty location list on ElectrumX 1.4.1.
 */
export function refGetArg(txid: string, vout: number): string {
  return `${txid.toLowerCase()}${(vout >>> 0).toString(16).padStart(8, "0")}`;
}

/* -------------------------------------------------------- discovery ----- */

interface TokenQuery {
  entry: ScannedAddress;
  kind: TokenKind;
  /** Zeroed-ref scripthash the indexer keys this address's tokens under. */
  hash: string;
}

/**
 * The zeroed-ref scripthash variants for one address. Subscribing to these
 * (in addition to the plain P2PKH hash) is what makes incoming tokens appear
 * in real time — see liveUpdates.ts.
 */
export function tokenScriptHashesFor(
  address: string,
): { kind: TokenKind; hash: string }[] {
  return (["nft", "ft"] as const).map((kind) => ({
    kind,
    hash: scriptHash(
      zeroRefs(
        kind === "nft"
          ? nftScript(address, ZERO_REF)
          : ftScript(address, ZERO_REF),
      ),
    ),
  }));
}

/**
 * Rebuild the on-chain script for a discovered UTXO and prove it belongs to
 * the query that surfaced it. Returns null when nothing matches — that means
 * the server sent a ref that does not correspond to this address/kind, which
 * must be ignored rather than trusted.
 */
function rebuildVerifiedScript(
  query: TokenQuery,
  refs: { ref: string }[],
): { script: string; ref: string; refDisplay: string } | null {
  for (const r of refs) {
    const parsed = parseServerRef(r.ref);
    if (!parsed) continue;
    const packed = packRef(parsed.txid, parsed.vout);
    const script =
      query.kind === "nft"
        ? nftScript(query.entry.key.address, packed)
        : ftScript(query.entry.key.address, packed);
    if (scriptHash(zeroRefs(script)) === query.hash) {
      return { script, ref: packed, refDisplay: `${parsed.txid}:${parsed.vout}` };
    }
  }
  return null;
}

/**
 * CHARACTERISATION fallback for servers that don't return refs in
 * listunspent: fetch the spending tx and parse the output script locally.
 * (The verified default server DOES return refs — probe-glyphs.mjs — so this
 * path is cold in practice.)
 */
async function resolveViaTransaction(
  client: ElectrumClient,
  query: TokenQuery,
  row: Utxo,
): Promise<{ script: string; ref: string; refDisplay: string } | null> {
  try {
    const raw = await client.request<string>(
      "blockchain.transaction.get",
      row.txid,
      false,
    );
    if (typeof raw !== "string") return null;
    // The output script is cheaper to parse via the verbose shape when the
    // server offers it, but raw parsing needs a tx decoder — radiantjs is
    // available through the SDK escape hatch. Keep this path minimal: it is
    // only exercised by non-conforming servers.
    const { radiantjs } = await import("@radiant-core/sdk");
    const tx = new radiantjs.Transaction(raw);
    const out = tx.outputs?.[row.vout];
    const script: string | undefined = out?.script?.toHex?.();
    if (!script || tokenScriptKind(script) !== query.kind) return null;
    const parsed =
      query.kind === "nft" ? parseNftScript(script) : parseFtScript(script);
    if (!parsed.ref || !parsed.addressHash) return null;
    const ours = parseP2pkhScript(p2pkhScript(query.entry.key.address));
    if (parsed.addressHash !== ours.addressHash) return null;
    const { txid, vout } = { txid: "", vout: 0, ...refParts(parsed.ref) };
    return { script, ref: parsed.ref, refDisplay: `${txid}:${vout}` };
  } catch {
    return null;
  }
}

/** unpackRef without throwing on odd input. */
function refParts(packed: string): { txid: string; vout: number } | null {
  try {
    const buf = hexToBytes(packed);
    if (buf.length !== 36) return null;
    const txid = bytesToHex(buf.slice(0, 32).reverse());
    const vout =
      (buf[32] | (buf[33] << 8) | (buf[34] << 16) | (buf[35] << 24)) >>> 0;
    return { txid, vout };
  } catch {
    return null;
  }
}

/* ------------------------------------------------- bytes (no Buffer) ---- */

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

/** Chunked btoa — WebView-safe (no Buffer global, see history.ts). */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/* ---------------------------------------------------- metadata layer ---- */

/** `gly` magic as it appears in the reveal's input script: push(3) "gly". */
export const GLYPH_MAGIC_PUSH = "03676c79";

/** Cap before CBOR-decoding — glyph data can embed megabytes of icon blobs. */
export const MAX_PAYLOAD_BYTES = 2_000_000;

/** Raster icon cap above the ~96 KB probe payload. */
export const MAX_ICON_BYTES = 300_000;

/** Only these MIME types may reach the WebView as a data: URI (XSS guard). */
export const ALLOWED_ICON_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

/**
 * Extract the CBOR glyph payload from a raw transaction hex, scanning every
 * `gly` magic occurrence (a copy could plausibly appear inside payload bytes
 * of an earlier multi-envelope input). Pure and offline — unit-testable.
 */
export function extractGlyphPayload(
  rawTxHex: string,
): Record<string, unknown> | null {
  const hex = rawTxHex.toLowerCase();
  let from = 0;
  for (;;) {
    const at = hex.indexOf(GLYPH_MAGIC_PUSH, from);
    if (at < 0) return null;
    const payload = decodePayload(hex, at + GLYPH_MAGIC_PUSH.length);
    if (payload) return payload;
    from = at + 2; // skip past this occurrence, try the next
  }
}

function decodePayload(
  hex: string,
  start: number,
): Record<string, unknown> | null {
  const byteAt = (i: number) => parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  let length: number;
  if (start * 2 + 2 > hex.length) return null;
  const head = byteAt(start);
  if (head <= 0x4b) {
    length = head;
    start += 1;
  } else if (head === 0x4d) {
    if ((start + 3) * 2 + 2 > hex.length) return null;
    length = (byteAt(start + 1) << 8) | byteAt(start + 2);
    start += 3;
  } else if (head === 0x4e) {
    if ((start + 5) * 2 + 2 > hex.length) return null;
    length =
      byteAt(start + 1) |
      (byteAt(start + 2) << 8) |
      (byteAt(start + 3) << 16) |
      (byteAt(start + 4) << 24);
    start += 5;
  } else {
    return null; // push > 0x18 MB never carries a sane glyph payload
  }
  if (length === 0 || length > MAX_PAYLOAD_BYTES) return null;
  const payloadHex = hex.slice(start * 2, start * 2 + length * 2);
  if (payloadHex.length < length * 2) return null;
  try {
    const decoded = cborDecode(hexToBytes(payloadHex)) as unknown;
    return isGlyphObject(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

function isGlyphObject(v: unknown): v is Record<string, unknown> {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    Array.isArray((v as Record<string, unknown>).p)
  );
}

/**
 * Map a raw CBOR payload to display metadata. `main` is inlined ({ t, b })
 * in the payloads observed so far, but the spec also allows
 * main → filename → embed{filename}; both shapes are handled.
 */
export function payloadToMetadata(
  payload: Record<string, unknown>,
): GlyphMetadata {
  const text = (v: unknown, cap = 500): string | undefined =>
    typeof v === "string" && v.length > 0 ? v.slice(0, cap) : undefined;

  const meta: GlyphMetadata = {
    protocols: (payload.p as unknown[])
      .filter((x): x is number => typeof x === "number" && Number.isFinite(x))
      .map((x) => x | 0),
  };
  const name = text(payload.name);
  if (name) meta.name = name;
  const ticker = text(payload.ticker, 16);
  if (ticker) meta.ticker = ticker;
  const description = text(payload.desc, 2000);
  if (description) meta.description = description;
  if (
    typeof payload.attrs === "object" &&
    payload.attrs !== null &&
    !Array.isArray(payload.attrs)
  ) {
    meta.attrs = payload.attrs as Record<string, unknown>;
  }

  const byteString = (v: unknown): Uint8Array | null =>
    v instanceof Uint8Array && v.length > 0 ? v : null;

  const embed =
    typeof payload.embed === "object" && payload.embed !== null
      ? (payload.embed as Record<string, unknown>)
      : {};
  const candidates: unknown[] = [payload.main];
  if (typeof payload.main === "string") {
    candidates.push(embed[payload.main]);
  }

  for (const c of candidates) {
    if (typeof c !== "object" || c === null) continue;
    const { t: mime, b: body } = c as Record<string, unknown>;
    const bytes = byteString(body);
    if (
      typeof mime === "string" &&
      ALLOWED_ICON_MIME.has(mime) &&
      bytes &&
      bytes.length <= MAX_ICON_BYTES
    ) {
      meta.iconDataUri = `data:${mime};base64,${bytesToBase64(bytes)}`;
      break;
    }
  }
  return meta;
}

/* ------------------------------------------------------ cache ----------- */

const CACHE_PREFIX = "lumen.glyphMeta.v1.";

function cacheKey(refDisplay: string): string {
  return CACHE_PREFIX + refDisplay.toLowerCase();
}

/** Metadata for IMMUTABLE tokens is permanent; mutable glyphs are re-fetched. */
function isCacheable(meta: GlyphMetadata): boolean {
  return !meta.protocols.includes(5);
}

export function loadCachedMetadata(refDisplay: string): GlyphMetadata | null {
  try {
    const raw = localStorage.getItem(cacheKey(refDisplay));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GlyphMetadata;
    return typeof parsed === "object" && parsed !== null && "protocols" in parsed
      ? parsed
      : null;
  } catch {
    return null; // private mode / quota / corrupt entry / SSR — all fine
  }
}

export function cacheMetadata(refDisplay: string, meta: GlyphMetadata): void {
  if (!isCacheable(meta)) return;
  try {
    localStorage.setItem(cacheKey(refDisplay), JSON.stringify(meta));
  } catch {
    // Quota: drop every glyph entry (cheap re-fetch) and retry once.
    try {
      const stale: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(CACHE_PREFIX)) stale.push(k);
      }
      for (const k of stale) localStorage.removeItem(k);
      localStorage.setItem(cacheKey(refDisplay), JSON.stringify(meta));
    } catch {
      /* give up silently — metadata is cosmetic */
    }
  }
}

/**
 * Best-effort metadata fetch for one ref: cached → ref.get → tx.get → CBOR.
 * Never throws: a bare mint (no envelope, e.g. probe tx 5eeb0648…) or a dead
 * server yields null and the UI falls back to "<Unnamed glyph>" + refDisplay.
 */
export async function fetchGlyphMetadata(
  client: ElectrumClient,
  refDisplay: string,
): Promise<GlyphMetadata | null> {
  const cached = loadCachedMetadata(refDisplay);
  if (cached) return cached;

  const parsed = parseServerRef(refDisplay);
  if (!parsed) return null;

  const locations = (await client
    .request<unknown>("blockchain.ref.get", refGetArg(parsed.txid, parsed.vout))
    .catch(() => null)) as
    | { tx_hash?: unknown; height?: unknown; vout?: unknown }[]
    | null;
  const loc = Array.isArray(locations)
    ? locations.find((l) => typeof l?.tx_hash === "string")
    : null;
  if (!loc) return null;

  const raw = await client
    .request<string>("blockchain.transaction.get", loc.tx_hash, false)
    .catch(() => null);
  if (typeof raw !== "string") return null;

  const payload = extractGlyphPayload(raw);
  if (!payload) return null; // bare mint — absence of envelope is normal

  const meta = payloadToMetadata(payload);
  cacheMetadata(refDisplay, meta);
  return meta;
}

/* ------------------------------------------------------- scanner -------- */

export interface TokenScanOptions {
  onProgress?: (message: string) => void;
  /** Fetch + cache glyph metadata after discovery. Default true. */
  withMetadata?: boolean;
}

/**
 * Discover every Glyph token this wallet owns.
 *
 * Strategy: query the ZEROED-ref NFT and FT scripthash for each USED address,
 * cross-check each returned row against the refs the indexer reports, rebuild
 * the token script locally, and only accept rows whose rebuilt script hashes
 * back to the query. Rows without refs fall back to per-transaction parsing
 * (characterised path — the verified default server always sends refs).
 */
export async function scanTokens(
  client: ElectrumClient,
  addresses: ScannedAddress[],
  options: TokenScanOptions = {},
): Promise<TokenScanResult> {
  const used = addresses.filter((a) => a.used);

  const queries: TokenQuery[] = used.flatMap((entry) => [
    { entry, kind: "nft" as const, hash: tokenScriptHashesFor(entry.key.address)[0].hash },
    { entry, kind: "ft" as const, hash: tokenScriptHashesFor(entry.key.address)[1].hash },
  ]);

  options.onProgress?.(`Querying token indexes (${queries.length} slots)…`);
  const rowsPerQuery = await mapLimit(queries, 4, (q) =>
    client
      .listUnspent(q.hash)
      .then((rows) => rows.map((row) => ({ query: q, row })))
      .catch(() => [] as { query: TokenQuery; row: Utxo }[]),
  );

  const utxos: TokenUtxo[] = [];
  const refless: { query: TokenQuery; row: Utxo }[] = [];

  for (const { query, row } of rowsPerQuery.flat()) {
    const refs = row.refs ?? [];
    const verified = rebuildVerifiedScript(query, refs);
    if (verified) {
      utxos.push({
        txid: row.txid,
        vout: row.vout,
        value: row.value,
        height: row.height,
        ...verified,
        kind: query.kind,
        ownerAddress: query.entry.key.address,
        ownerWif: query.entry.key.wif,
        ownerIndex: query.entry.key.index,
        ownerChange: query.entry.change,
      });
    } else if (refs.length === 0) {
      refless.push({ query, row });
    }
    // refs present but unverified → ignore: does not belong to this address.
  }

  if (refless.length > 0) {
    options.onProgress?.(`Resolving ${refless.length} token outputs by transaction…`);
    const resolved = await mapLimit(refless, 4, ({ query, row }) =>
      resolveViaTransaction(client, query, row),
    );
    resolved.forEach((verified, i) => {
      if (!verified) return;
      const { query, row } = refless[i];
      utxos.push({
        txid: row.txid,
        vout: row.vout,
        value: row.value,
        height: row.height,
        ...verified,
        kind: query.kind,
        ownerAddress: query.entry.key.address,
        ownerWif: query.entry.key.wif,
        ownerIndex: query.entry.key.index,
        ownerChange: query.entry.change,
      });
    });
  }

  // Group by ref. The ref is the token's identity — never name or ticker,
  // which are free-form and collide freely.
  const byRef = new Map<string, TokenBalance>();
  for (const u of utxos) {
    let b = byRef.get(u.ref);
    if (!b) {
      b = {
        ref: u.ref,
        refDisplay: u.refDisplay,
        kind: u.kind,
        amount: 0n,
        lockedPhotons: 0n,
        utxos: [],
      };
      byRef.set(u.ref, b);
    }
    b.utxos.push(u);
    b.lockedPhotons += u.value;
    b.amount += u.value;
  }

  const tokens = [...byRef.values()];

  if (options.withMetadata !== false && tokens.length > 0) {
    options.onProgress?.("Fetching glyph metadata…");
    const metas = await mapLimit(tokens, 4, (t) =>
      fetchGlyphMetadata(client, t.refDisplay),
    );
    metas.forEach((meta, i) => {
      if (meta) tokens[i].metadata = meta;
    });
  }

  options.onProgress?.(`Found ${tokens.length} token(s) in ${utxos.length} UTXO(s).`);

  return {
    tokens,
    utxos,
    lockedPhotons: utxos.reduce((sum, u) => sum + u.value, 0n),
  };
}
