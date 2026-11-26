/**
 * Offline unit checks for the PURE Glyph helpers in src/lib/glyphs.ts.
 *
 * Built with vite.glyph-check.config.ts and run on node, mirroring
 * scripts/browser-path-check.ts. Everything here is deterministic: fixtures are
 * reconstructed with the SDK itself (nftScript/ftScript/cbor-x), never from
 * hand-typed hex, so a drifted dependency fails loudly rather than silently
 * agrees with a stale fixture.
 */
import {
  DUST_LIMIT,
  ftScript,
  nftScript,
  packRef,
  p2pkhScript,
} from "@radiant-core/sdk";
import { encode as cborEncode } from "cbor-x";
import {
  extractGlyphPayload,
  refGetArg,
  tokenScriptHashesFor,
  tokenFreeFunding,
  estimateTokenSendFee,
  payloadToMetadata,
  parseServerRef,
  FT_DUST_LIMIT,
} from "../src/lib/glyphs";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  OK  " : "  FAIL"} ${label}${detail ? "  " + detail : ""}`);
  if (!ok) failures++;
}

const ADDR = "18qiat9Kff5niCcincht6efD8HhFfzL1AJ";
const TXID = "4b4c4d4e4f505152535455565758595a5b5c5d5e5f6061626364656667681234"; // 64 hex, fake but well-formed

function hex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

/** A script-level push of `bytes` using the minimal (or 4D/4E) header. */
function push(bytes: Uint8Array): string {
  const n = bytes.length;
  if (n <= 0x4b) return hex(new Uint8Array([n])) + hex(bytes);
  if (n <= 0xffff) {
    const head = new Uint8Array([0x4d, n & 0xff, (n >> 8) & 0xff]);
    return hex(head) + hex(bytes);
  }
  const head = new Uint8Array([0x4e, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]);
  return hex(head) + hex(bytes);
}

const GLY_PUSH = "03676c79";

/** Assemble a fake reveal transaction: junk prefix + `gly` push + payload push. */
function fakeTx(payloadHex: string, prefixPenalty = ""): string {
  return (
    "0100000001" +
    (prefixPenalty || "aa".repeat(24)) +
    GLY_PUSH +
    push(unhex(payloadHex))
  );
}

function unhex(h: string): Uint8Array {
  const out = new Uint8Array(h.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

// --------------------------------------------------------- parseServerRef -

check("parseServerRef accepts every server spelling", (() => {
  const txidLower = TXID.toLowerCase();
  return (
    parseServerRef(`${txidLower}i3`)?.vout === 3 &&
    parseServerRef(`${txidLower}:3`)?.vout === 3 &&
    parseServerRef(`${txidLower}_3`)?.vout === 3 &&
    parseServerRef(TXID + "i0")?.vout === 0
  );
})());

check("parseServerRef is null for non-ref shapes", (() => {
  return (
    parseServerRef("not-a-ref") === null &&
    parseServerRef(TXID.slice(0, 63) + "i0") === null &&
    parseServerRef(TXID + "i") === null &&
    parseServerRef(TXID.replace(/\d/g, "g") + "i0") === null &&
    parseServerRef("") === null
  );
})());

check("parseServerRef bounds the vout to 10 digits", (() => {
  return (
    parseServerRef(TXID + "i9999999999")?.vout === 9999999999 &&
    parseServerRef(TXID + "i99999999999") === null
  );
})());

// -------------------------------------------------------------- refGetArg -

check("refGetArg serialises vout as 4-byte BIG-endian (pinned by probe)", (() => {
  return (
    refGetArg(TXID, 0) === TXID.toLowerCase() + "00000000" &&
    refGetArg(TXID, 1) === TXID.toLowerCase() + "00000001" &&
    refGetArg(TXID, 16909060) === TXID.toLowerCase() + "01020304"
  );
})());

// ------------------------------------------------------ tokenScriptHashes -

check("tokenScriptHashesFor yields two distinct 64-hex hashes", (() => {
  const hashes = tokenScriptHashesFor(ADDR);
  return (
    hashes.length === 2 &&
    hashes.every((h) => /^[0-9a-f]{64}$/.test(h.hash)) &&
    hashes[0].hash !== hashes[1].hash
  );
})());

check("hashes are pure (identical across calls)", (() => {
  const a = tokenScriptHashesFor(ADDR);
  const b = tokenScriptHashesFor(ADDR);
  return a[0].hash === b[0].hash && a[1].hash === b[1].hash;
})());

// ------------------------------------------------------------- payload ---
const payload: Record<string, unknown> = {
  v: 1,
  p: [2, 5],
  name: "Fabled Longbow",
  desc: "A longbow of some repute.",
  attrs: { rarity: "legendary", shots: 3 },
  main: {
    t: "image/png",
    b: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]),
  },
};
const payloadHex = hex(new Uint8Array(cborEncode(payload)) as Uint8Array);

check("extractGlyphPayload decodes a real-shaped CBOR envelope", (() => {
  const decoded = extractGlyphPayload(fakeTx(payloadHex));
  return (
    decoded !== null &&
    decoded.name === "Fabled Longbow" &&
    Array.isArray(decoded.p) &&
    (decoded.p as number[])[0] === 2
  );
})());

check("payload survives a >76-byte (>0x4b) push form", (() => {
  const padded = { ...payload, desc: payload.desc + " " + "x".repeat(80) };
  const decoded = extractGlyphPayload(
    fakeTx(hex(new Uint8Array(cborEncode(padded)) as Uint8Array)),
  );
  return (
    decoded !== null && (decoded.desc as string).endsWith("x".repeat(80))
  );
})());

check("extractGlyphPayload returns null without a gly envelope", (() => {
  return (
    extractGlyphPayload("0100000001" + "aa".repeat(64) + payloadHex) === null
  );
})());

check("extractGlyphPayload skips a corrupt first envelope", (() => {
  const tx =
    "0100" +
    "01" +
    GLY_PUSH +
    hex(new Uint8Array([0x01, 0xff])) +
    "aa".repeat(8) +
    "02" +
    GLY_PUSH +
    push(unhex(payloadHex));
  const decoded = extractGlyphPayload(tx);
  return decoded !== null && decoded.name === "Fabled Longbow";
})());

check("extractGlyphPayload rejects an oversized payload before CBOR", (() => {
  const claimed = 2_100_000; // above MAX_PAYLOAD_BYTES (2 MB)
  const le = (n: number) => n.toString(16).padStart(2, "0");
  const head =
    "4e" +
    le(claimed & 0xff) +
    le((claimed >> 8) & 0xff) +
    le((claimed >> 16) & 0xff) +
    le((claimed >>> 24) & 0xff);
  return extractGlyphPayload(fakeTx(head + "bb".repeat(96))) === null;
})());

check("extractGlyphPayload rejects a truncated push", (() => {
  // Claims 200 bytes, supplies 20.
  return extractGlyphPayload(fakeTx("c8" + "bb".repeat(20))) === null;
})());

// ------------------------------------------------------------ metadata ---
check("payloadToMetadata maps name/desc/attrs + raster icon", (() => {
  const meta = payloadToMetadata(payload);
  return (
    meta.name === "Fabled Longbow" &&
    meta.description === "A longbow of some repute." &&
    meta.protocols.join(",") === "2,5" &&
    meta.attrs?.rarity === "legendary" &&
    meta.attrs?.shots === 3 &&
    (meta.iconDataUri ?? "").startsWith("data:image/png;base64,")
  );
})());

check("SVG icons are dropped (WebView XSS guard)", (() => {
  const svg = payloadToMetadata({
    p: [2],
    main: {
      t: "image/svg+xml",
      b: new Uint8Array([0x3c, 0x73, 0x76, 0x67]),
    },
  });
  return svg.iconDataUri === undefined;
})());

check("text/html icons are dropped", (() => {
  const html = payloadToMetadata({
    p: [2],
    main: { t: "text/html", b: new Uint8Array([0x3c, 0x68, 0x31]) },
  });
  return html.iconDataUri === undefined;
})());

check("icons above the 300 KB cap are dropped", (() => {
  const meta = payloadToMetadata({
    p: [2],
    main: { t: "image/png", b: new Uint8Array(300_001) },
  });
  return meta.iconDataUri === undefined;
})());

check("string main resolves through the embed table", (() => {
  const meta = payloadToMetadata({
    p: [2],
    main: "cover",
    embed: {
      cover: { t: "image/jpeg", b: new Uint8Array([1, 2, 3, 4]) },
    },
  });
  return (meta.iconDataUri ?? "").startsWith("data:image/jpeg;base64,");
})());

check("ticker is capped at 16 chars", (() => {
  const meta = payloadToMetadata({ p: [2], ticker: "a".repeat(40) });
  return (meta.ticker?.length ?? 0) <= 16;
})());

check("empty payloads still yield a protocols array", (() => {
  const meta = payloadToMetadata({ p: [] });
  return Array.isArray(meta.protocols) && meta.protocols.length === 0;
})());

check("FT_DUST_LIMIT matches the SDK dust limit", (() => {
  return FT_DUST_LIMIT === DUST_LIMIT && FT_DUST_LIMIT > 0n;
})());

// ---------------------------------------------------- funding boundary ---
import type { ScanResult } from "../src/lib/wallet";

const packedRef = packRef(TXID, 0);
const nftScriptHex = nftScript(ADDR, packedRef);
const ftScriptHex = ftScript(ADDR, packedRef);
const cleanScript = p2pkhScript(ADDR);

const mkOwned = (
  txidSeed: string,
  script: string,
  refs: { ref: string; type: string }[],
) => ({
  txid: txidSeed.repeat(32),
  vout: 0,
  value: 50_000_000n,
  script,
  height: 100,
  refs,
  ownerAddress: ADDR,
  ownerWif: "L1fixturewifnotused0000000000000000000000000000",
  ownerIndex: 0,
  ownerChange: 0,
});

const scan = {
  addresses: [],
  utxos: [
    mkOwned("aa", cleanScript, []),
    // A token-shaped script sneaking in under the plain P2PKH scan must be
    // dropped by the boundary, not by the SDK's last line of defence alone.
    mkOwned("bb", nftScriptHex, []),
    mkOwned("cc", cleanScript, [{ ref: `${TXID}i1`, type: "single" }]),
    // An FT UTXO from a DIFFERENT owner — must never leak into this token's
    // funding (single-WIF signing rule).
    { ...mkOwned("dd", cleanScript, []), ownerAddress: ADDR.slice(0, -1) + "K" },
  ],
  confirmed: 0n,
  unconfirmed: 0n,
  total: 0n,
  tokenUtxoCount: 0,
  nextReceive: undefined,
  nextChange: undefined,
} as unknown as ScanResult;

// Generous funding so doubled fee rates still select successfully — the
// dedicated thin-funding scan below covers the budget-exhausted path.
const fatScan = {
  addresses: [],
  utxos: [{ ...mkOwned("ee", cleanScript, []), value: 500_000_000n }],
  confirmed: 0n,
  unconfirmed: 0n,
  total: 0n,
  tokenUtxoCount: 0,
  nextReceive: undefined,
  nextChange: undefined,
} as unknown as ScanResult;

check("tokenFreeFunding keeps only this owner's token-free RXD", (() => {
  const funding = tokenFreeFunding(scan, ADDR);
  return funding.length === 1 && funding[0].txid === "aa".repeat(32);
})());

check("tokenFreeFunding never leaks into another owner's cleanup", (() => {
  const other = "1OtherOwnerXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
  const emptyScan = { ...scan, utxos: [mkOwned("aa", cleanScript, [])] };
  return tokenFreeFunding(emptyScan, other).length === 0;
})());

// ------------------------------------------------------- fee estimation --
const nftToken = {
  ref: packedRef,
  refDisplay: `${TXID}:0`,
  kind: "nft" as const,
  amount: 1n,
  lockedPhotons: 900_000_000n,
  utxos: [
    {
      txid: "bb".repeat(32),
      vout: 0,
      value: 900_000_000n,
      script: nftScriptHex,
      ref: packedRef,
      refDisplay: `${TXID}:0`,
      kind: "nft" as const,
      ownerAddress: ADDR,
      ownerWif: "L1fixturewifnotused0000000000000000000000000000",
      ownerIndex: 0,
      ownerChange: 0,
    },
  ],
};

const ftToken = {
  ref: packedRef,
  refDisplay: `${TXID}:0`,
  kind: "ft" as const,
  amount: 600n,
  lockedPhotons: 600n,
  utxos: [
    {
      txid: "cc".repeat(32),
      vout: 0,
      value: 600n,
      script: ftScriptHex,
      ref: packedRef,
      refDisplay: `${TXID}:0`,
      kind: "ft" as const,
      ownerAddress: ADDR,
      ownerWif: "L1fixturewifnotused0000000000000000000000000000",
      ownerIndex: 0,
      ownerChange: 0,
    },
  ],
};

const FEE = 50_000n;

check("NFT send fee estimate is positive and fee-rate aware", (() => {
  const a = estimateTokenSendFee(fatScan, nftToken, null, FEE);
  const b = estimateTokenSendFee(fatScan, nftToken, null, FEE * 2n);
  return a !== null && b !== null && a > 0n && b > a;
})());

check("FT partial-send fee estimate covers the change output path", (() => {
  return estimateTokenSendFee(scan, ftToken, 300n, FEE) !== null;
})());

check("FT whole-balance fee estimate is a single (no-change) path", (() => {
  return estimateTokenSendFee(scan, ftToken, 600n, FEE) !== null;
})());

check("fee estimate returns null for an impossible amount", (() => {
  return estimateTokenSendFee(scan, ftToken, 601n, FEE) === null &&
    estimateTokenSendFee(scan, ftToken, 0n, FEE) === null;
})());

check("fee estimate returns null with no fee budget", (() => {
  const brokeScan = { ...scan, utxos: [] } as unknown as ScanResult;
  return (
    estimateTokenSendFee(brokeScan, nftToken, null, FEE) === null &&
    estimateTokenSendFee(brokeScan, ftToken, 300n, FEE) === null
  );
})());

// ----------------------------------------------------------------------- //
console.log(
  failures === 0
    ? "\nAll glyph-helper checks passed -> exit 0"
    : `\n${failures} check(s) FAILED -> exit 1`,
);
process.exit(failures === 0 ? 0 : 1);




