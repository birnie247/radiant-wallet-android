// Ref-safety fingerprint checks — the Phase 2 burn-guard gate.
//
// Spending a token-bearing UTXO as ordinary RXD funding silently and
// irreversibly BURNS the token. Detection must be shape-based: walk the
// script as an opcode stream, skipping push payloads. The two traps this
// script pins down:
//
//   FALSE POSITIVE — a P2PKH hash160 whose 20-byte payload happens to contain
//   0xd0–0xd3/0xd8 bytes must stay funding-SAFE (a raw byte scan would
//   mis-flag it and strand the user's funds).
//
//   FALSE NEGATIVE — a real NFT/FT covenant script, or a plain script whose
//   indexer row reports refs, must NEVER be selected as funding.
//
// Pure/offline: no network, exits 1 on the first failed invariant.
// Run: node scripts/check-ref-safety.mjs
import {
  HDWallet,
  InsufficientFundsError,
  TokenBurnGuardError,
  assertFundingSafe,
  filterFundingCandidates,
  ftScript,
  isFundingSafe,
  isTokenBearing,
  nftScript,
  packRef,
  selectRxdFunding,
  tokenScriptKind,
} from "@radiant-core/sdk";

const results = [];
const check = (title, ok, detail) => {
  results.push({ title, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${title}`);
  if (detail) console.log(`      ${detail}`);
};

const wallet = HDWallet.fromMnemonic(HDWallet.generateMnemonic());
const address = wallet.deriveKey(0, 0).address;

const ref = packRef("aa".repeat(32), 1);
const nft = nftScript(address, ref);
const ft = ftScript(address, ref);

/* 1. P2PKH whose hash160 payload is FULL of ref-opcode bytes must be safe. */
const trapHash = "d0d1d2d3d8" + "d8".repeat(15); // 20 bytes of pure trap bytes
const trapP2pkh = `76a914${trapHash}88ac`;
check(
  "P2PKH with 0xd0-0xd8 bytes inside hash160 stays token-free",
  isTokenBearing(trapP2pkh) === false,
  trapP2pkh,
);

/* 2. An NFT-looking byte sequence inside a PUSH payload is not a token. */
const pushTrap =
  "6a" + // OP_RETURN
  "26" + // push 38 bytes
  "d8" + ref + "75"; // exactly the NFT prefix, but as inert data
check(
  "NFT-shaped bytes inside a data push stay token-free",
  isTokenBearing(pushTrap) === false,
);

/* 3. A real NFT script is token-bearing and unfundable. */
check("NFT script is token-bearing", isTokenBearing(nft) === true);
check("NFT script classifies as nft", tokenScriptKind(nft) === "nft");
check(
  "NFT UTXO is not funding-safe",
  isFundingSafe({ txid: "aa".repeat(32), vout: 0, value: 1000n, script: nft }) ===
    false,
);

/* 4. A real FT script is token-bearing and unfundable. */
check("FT script is token-bearing", isTokenBearing(ft) === true);
check("FT script classifies as ft", tokenScriptKind(ft) === "ft");
check(
  "FT UTXO is not funding-safe",
  isFundingSafe({ txid: "bb".repeat(32), vout: 0, value: 5000n, script: ft }) ===
    false,
);

/* 5. Indexer-reported refs on a plain script still block funding. */
const withRefs = {
  txid: "cc".repeat(32),
  vout: 0,
  value: 100_000n,
  script: trapP2pkh, // script itself is clean…
  refs: [{ ref: `${"dd".repeat(32)}i0`, type: "single" }], // …but the indexer says token
};
check(
  "indexer-reported refs block funding even on a clean script",
  isFundingSafe(withRefs) === false,
);

/* 6. Filtering keeps exactly the plain candidates. */
const plain = { txid: "ee".repeat(32), vout: 1, value: 25_000_000n, script: trapP2pkh };
const filtered = filterFundingCandidates([
  plain,
  withRefs,
  { txid: "aa".repeat(32), vout: 0, value: 1000n, script: nft },
  { txid: "bb".repeat(32), vout: 0, value: 5000n, script: ft },
]);
check(
  "filterFundingCandidates keeps only token-free UTXOs",
  filtered.length === 1 && filtered[0].txid === plain.txid,
  `kept ${filtered.length}/4`,
);

/* 7. assertFundingSafe throws the typed burn-guard error. */
let threw = null;
try {
  assertFundingSafe([{ txid: "aa".repeat(32), vout: 0, value: 1000n, script: nft }]);
} catch (e) {
  threw = e;
}
check(
  "assertFundingSafe throws TokenBurnGuardError",
  threw instanceof TokenBurnGuardError,
  threw?.constructor?.name,
);

/* 8. Selection over a mixed set picks ONLY the plain UTXO. */
try {
  const selection = selectRxdFunding(
    [
      { txid: "aa".repeat(32), vout: 0, value: 900_000_000n, script: nft }, // juicy but toxic
      { txid: "bb".repeat(32), vout: 0, value: 900_000_000n, script: ft },
      plain, // the only honest funding
    ],
    50_000n,
    10_000n,
    { baseOutputCount: 1, withChange: true },
  );
  check(
    "selectRxdFunding ignores high-value token UTXOs",
    selection.inputs.length === 1 && selection.inputs[0].txid === plain.txid,
    `inputs=${selection.inputs.length} fee=${selection.fee} change=${selection.change}`,
  );
} catch (e) {
  check("selectRxdFunding ignores high-value token UTXOs", false, e.message);
}

/* 9. Tokens alone cannot fund anything — the error is typed, not a burn. */
let ins = null;
try {
  selectRxdFunding(
    [{ txid: "aa".repeat(32), vout: 0, value: 9_000_000n, script: nft }],
    50_000n,
    10_000n,
  );
} catch (e) {
  ins = e;
}
check(
  "token-only wallet reports InsufficientFundsError (never spends the token)",
  ins instanceof InsufficientFundsError,
  ins?.constructor?.name,
);

const failed = results.filter((r) => !r.ok);
console.log(
  `\n${results.length - failed.length}/${results.length} checks passed -> exit ${failed.length ? 1 : 0}`,
);
process.exitCode = failed.length ? 1 : 0;
