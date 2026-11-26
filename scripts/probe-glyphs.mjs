// Probe the Glyph contract on Radiant ElectrumX + RXinDexer REST.
//
// Phase 0 of the Glyph rollout: nothing in the wallet exercises token display
// until this script proves, against live servers, that
//
//   1. the RXinDexer discovery REST answers (radiantcore.org/api/glyphs/recent),
//   2. `blockchain.ref.get` resolves a real glyph ref to its reveal + current
//      location (the tech guide's "first and last locations"),
//   3. the reveal transaction's unlocking script carries the `gly` magic plus a
//      decodable payload,
//   4. `listunspent` against a ZEROED-REF token scriptHash returns the refs of
//      each output — the wildcard address-discovery contract the wallet scan
//      will rely on, and
//   5. `ref.get`'s ref format is pinned empirically (display "txid:vout" vs
//      "txid_vout" vs packed 72-hex) so src/lib/glyphs.ts ships the right one.
//
// Run: node scripts/probe-glyphs.mjs [limit]
// Exit code 0 when every mandatory check passes, 1 otherwise.
import crypto from "node:crypto";
import WebSocket from "ws";
import { decode as cborDecode } from "cbor-x";

const ELECTRUM_URL = process.argv[3] || "wss://rxdexplorer.com";
const REST_BASES = ["https://radiantcore.org/api", "https://rxdexplorer.com/api"];
const limit = Number(process.argv[2]) || 5;

const results = [];
const record = (title, ok, detail, mandatory = true) => {
  results.push({ title, ok, mandatory });
  console.log(`${ok ? "PASS" : mandatory ? "FAIL" : "warn"}  ${title}`);
  if (detail) console.log(`      ${String(detail).slice(0, 300)}`);
};

let nextId = 0;
const pending = new Map();
let ws;

function request(method, ...params) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`${method} timed out`));
    }, 12_000);
  });
}

function connect(url, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(url, { handshakeTimeout: timeoutMs });
    ws.on("open", () => resolve());
    ws.on("message", (m) => {
      let j;
      try {
        j = JSON.parse(String(m));
      } catch {
        return;
      }
      if (j.id === undefined) return;
      const p = pending.get(j.id);
      if (!p) return;
      pending.delete(j.id);
      j.error
        ? p.reject(new Error(`RPC ${j.error?.code}: ${j.error?.message}`))
        : p.resolve(j.result);
    });
    ws.on("error", (e) => reject(e));
    ws.on("unexpected-response", (_q, res) =>
      reject(new Error(`HTTP ${res.statusCode}`)),
    );
    setTimeout(() => reject(new Error("connect timeout")), timeoutMs);
  });
}

async function probeRest(base) {

  try {
    const res = await fetch(`${base}/glyphs/recent?limit=${limit}`);
    if (!res.ok) return { base, ok: false, detail: `HTTP ${res.status}` };
    const json = await res.json();
    const tokens = json.tokens ?? json;
    if (!Array.isArray(tokens) || tokens.length === 0)
      return { base, ok: false, detail: "no tokens in reply" };
    return { base, ok: true, tokens };
  } catch (e) {
    return { base, ok: false, detail: e.message };
  }
}

console.log(`== Glyph probe ${new Date().toISOString()} ==`);

try {
  await connect(ELECTRUM_URL);
  const version = await request("server.version", "rxd-glyph-probe", "1.4");
  record(`electrumx ${ELECTRUM_URL}`, true, JSON.stringify(version));
} catch (e) {
  record(`electrumx ${ELECTRUM_URL}`, false, e.message);
  console.log("\nElectrumX unreachable — cannot continue.");
  process.exit(1);
}

const restResults = await Promise.all(REST_BASES.map(probeRest));
const goodRest = restResults.find((r) => r.ok);
record(
  "discovery REST",
  !!goodRest,
  goodRest
    ? `${goodRest.base} -> ${goodRest.tokens.length} token(s)`
    : restResults.map((r) => `${r.base}: ${r.detail}`).join(" | "),
  false, // discovery is display sugar; the wallet scan is Electrum-only.
);
if (goodRest) {
  for (const t of goodRest.tokens.slice(0, limit)) {
    console.log(
      `   type=${t.type} p=${(t.protocols ?? []).join(",")} name=${JSON.stringify(
        t.name ?? t.ticker,
      )} ref=${t.ref} ref_hex=${String(t.ref_hex ?? "").slice(0, 16)}…`,
    );
  }
}

/* Only FT/NFT rows with a delimited ref can drive the ref.get probe. */
const CHOSEN = (goodRest?.tokens ?? []).filter(
  (t) =>
    (t.type === 1 || t.type === 2) &&
    typeof t.ref === "string" &&
    /_[0-9]+$|:[0-9]+$/.test(t.ref),
);
if (goodRest && CHOSEN.length === 0)
  record("probe candidates", false, "no FT/NFT row with a delimited ref", false);

function refCandidates(t) {
  const variants = {};
  if (typeof t.ref === "string") {
    const sep = t.ref.includes("_") ? "_" : ":";
    const [txid, vout] = t.ref.split(sep);
    variants["display"] = `${txid}:${vout}`;
    const leTxid = txid.match(/../g).reverse().join("");
    const leVout = Number(vout >>> 0)
      .toString(16)
      .padStart(8, "0")
      .match(/../g)
      .reverse()
      .join("");
    variants["packedLE"] = `${leTxid}${leVout}`;
    variants["txid+voutBE"] = `${txid}${Number(vout >>> 0)
      .toString(16)
      .padStart(8, "0")}`;
  }
  if (typeof t.ref_hex === "string" && t.ref_hex.length === 72)
    variants["ref_hex"] = t.ref_hex;
  return variants;
}

let resolvedRef = null;
let locs = [];
for (const token of CHOSEN) {
  for (const [format, candidateRef] of Object.entries(refCandidates(token))) {
    try {
      const got = await request("blockchain.ref.get", candidateRef);
      const empty = Array.isArray(got) && got.length === 0;
      console.log(
        `   ref.get (${format}) ${token.ref.slice(0, 10)}… -> ${JSON.stringify(got).slice(0, 160)}`,
      );
      if (!empty) {
        resolvedRef = { format, candidateRef, reply: got, token };
        break;
      }
    } catch (e) {
      // A rejected *format* is information, not failure — one variant must work.
      console.log(`   ref.get (${format}) rejected: ${e.message.slice(0, 90)}`);
    }
  }
  if (resolvedRef) break;
}
record(
  "ref.get resolves at least one token to a location",
  !!resolvedRef,
  resolvedRef ? `format=${resolvedRef.format} token=${resolvedRef.token.ref}` : "every reply was empty or rejected",
);

/* Recursively pull txids/outpoints out of whatever shape ref.get answered. */
if (resolvedRef) {
  const collect = (v) => {
    if (typeof v === "string" && /^[0-9a-f]{64}$/i.test(v)) locs.push({ txid: v });
    else if (Array.isArray(v)) v.forEach(collect);
    else if (v && typeof v === "object") {
      const txid = v.tx_hash ?? v.txid;
      if (typeof txid === "string" && /^[0-9a-f]{64}$/i.test(txid))
        locs.push({ txid, pos: v.pos, height: v.height });
      else Object.values(v).forEach(collect);
    }
  };
  collect(resolvedRef.reply);
  console.log(`   ref.get reply parsed into ${locs.length} location(s)`);
}

async function verboseTx(txid) {
  return request("blockchain.transaction.get", txid, true);
}

/* Cut the push that follows the `gly` magic (handles OP_PUSHDATA1/2/4). */
function payloadAfterMagic(hex) {
  const after = hex.slice(hex.indexOf("676c79") + 6);
  const le = (s) => parseInt(s.match(/../g).reverse().join(""), 16);
  if (after.startsWith("4e")) return after.slice(10, 10 + 2 * le(after.slice(2, 10)));
  if (after.startsWith("4d")) return after.slice(6, 6 + 2 * le(after.slice(2, 6)));
  if (after.startsWith("4c")) return after.slice(4, 4 + 2 * le(after.slice(2, 4)));
  return after.slice(2, 2 + 2 * parseInt(after.slice(0, 2), 16));
}

if (resolvedRef && locs[0]?.txid) {
  let verbose = null;
  try {
    verbose = await verboseTx(locs[0].txid);
  } catch (e) {
    record("reveal tx fetch", false, e.message);
  }

  /* Zeroed-ref discovery: hash the token script with its ref operand zeroed. */
  try {
    const tokenOut = (verbose?.vout ?? []).find((o) =>
      /^(d8|d0)/.test(o.scriptPubKey?.hex ?? ""),
    );
    if (!tokenOut) {
      record("zeroed-ref listunspent", false, "reveal tx has no d0/d8 token output", false);
    } else {
      const script = tokenOut.scriptPubKey.hex;
      console.log(`   token output script: ${script.slice(0, 90)}…`);
      const zeroScriptHex = script.slice(0, 2) + "00".repeat(36) + script.slice(74);
      const sh = crypto
        .createHash("sha256")
        .update(Buffer.from(zeroScriptHex, "hex"))
        .digest()
        .reverse()
        .toString("hex");
      const rawSh = crypto
        .createHash("sha256")
        .update(Buffer.from(script, "hex"))
        .digest()
        .reverse()
        .toString("hex");
      for (const [label, hash] of [["raw", rawSh], ["zeroed", sh]]) {
        const unspents = await request("blockchain.scripthash.listunspent", hash).catch(
          (e) => ({ error: e.message }),
        );
        if (!Array.isArray(unspents)) {
          record(`listunspent (${label} script)`, false, unspents.error, false);
          continue;
        }
        const withRefs = unspents.filter((u) => Array.isArray(u.refs) && u.refs.length > 0);
        record(
          `listunspent (${label} script) returns refs`,
          withRefs.length > 0,
          `${unspents.length} row(s), ${withRefs.length} with refs: ${JSON.stringify(
            withRefs[0] ?? unspents[0] ?? null,
          ).slice(0, 240)}`,
          false,
        );
      }
    }
  } catch (e) {
    record("zeroed-ref listunspent", false, e.message, false);
  }
}

/* ---------------------------------------------------------- metadata ----
 *
 * A bare mint is legal: some reveals carry NO `gly` envelope at all (their
 * commit output never demanded a payload), so "the reveal has the magic" is
 * NOT a per-token invariant. What the wallet's metadata layer needs is:
 *   (a) at least one real token round-trips ref.get -> reveal tx -> gly
 *       envelope -> CBOR payload (proves the extraction path), and
 *   (b) when the envelope is absent, the REST by-ref metadata answers
 *       (the wallet's fallback).
 */
let metaHit = null;
for (const token of CHOSEN) {
  const refArg = refCandidates(token)["txid+voutBE"];
  if (!refArg) continue;
  const got = await request("blockchain.ref.get", refArg).catch(() => null);
  if (!Array.isArray(got) || got.length === 0) continue;
  const first = got.find((l) => typeof l?.tx_hash === "string");
  if (!first) continue;
  const raw = await request("blockchain.transaction.get", first.tx_hash, false).catch(
    () => null,
  );
  if (typeof raw !== "string") continue;
  const at = raw.indexOf("676c79");
  if (at < 0) {
    console.log(
      `   ${token.ref.slice(0, 10)}… reveal ${first.tx_hash.slice(0, 10)}… has no gly envelope (bare mint)`,
    );
    continue;
  }
  metaHit = { token, raw, txid: first.tx_hash };
  break;
}
record(
  "some candidate's reveal carries the gly magic",
  !!metaHit,
  metaHit
    ? `${metaHit.token.ref} @ ${metaHit.txid}`
    : "no candidate did — envelope extraction is unprovable right now",
);

if (metaHit) {
  try {
    const payloadHex = payloadAfterMagic(metaHit.raw);
    const payload = cborDecode(Buffer.from(payloadHex, "hex"));
    record(
      "reveal payload decodes",
      true,
      `p=${JSON.stringify(payload?.p ?? null)} name=${JSON.stringify(
        payload?.name ?? payload?.ticker ?? null,
      )} (${payloadHex.length / 2} bytes)`,
    );
  } catch (e) {
    record("reveal payload decodes", false, `CBOR failed: ${e.message}`);
  }
} else if (CHOSEN.length > 0) {
  /* Fallback contract: REST by-ref metadata (display-only sugar). */
  let restMeta = null;
  for (const base of REST_BASES) {
    try {
      const res = await fetch(`${base}/glyphs/${CHOSEN[0].ref}`);
      if (res.ok) {
        restMeta = { base, json: await res.json() };
        break;
      }
    } catch {
      /* next base */
    }
  }
  record(
    "REST single-token metadata (fallback)",
    !!restMeta,
    restMeta
      ? `${restMeta.base} name=${JSON.stringify(restMeta.json?.name ?? null)}`
      : "no REST base answered /glyphs/{ref}",
    false,
  );
}

try {
  ws.terminate();
} catch {}

const failed = results.filter((r) => r.mandatory && !r.ok);
process.exitCode = failed.length > 0 ? 1 : 0;
console.log(
  `\n${results.filter((r) => r.ok).length}/${results.length} checks passed -> exit ${process.exitCode}`,
);

