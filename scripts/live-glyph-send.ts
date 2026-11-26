/**
 * Live Glyph mint + send harness against rxdexplorer.com.
 *
 * Modes (composable):
 *   (no flags)        recon + DRY-RUN send of the first token. Read-only.
 *   --mint            mint a REAL fresh token (commit+reveal broadcast), then
 *                     re-scan. Requires RXD_SEND_CONFIRM=SEND + a funded,
 *                     non-test-vector wallet. Without --broadcast the subsequent
 *                     send is still a dry-run (inspect the signed tx).
 *   --broadcast       broadcast the SEND for real (same confirmation guards).
 *   --mint --broadcast  full end-to-end: mint then send, all on-chain.
 *
 * Options:
 *   --mint-ft --ticker T --supply N   mint an FT instead of an NFT
 *   --to <address>                    send destination (default: own receive[1])
 *   --amount N                        FT partial amount (default: whole balance)
 *
 * Wallet source (first match wins):
 *   RXD_MNEMONIC env var    your own funded phrase (never logged)
 *   --mnemonic-file PATH    file containing the phrase
 *   otherwise               public BIP39 test vector — recon only; mint/broadcast
 *                           from it is refused.
 *
 * Run: npm run live:glyph -- [flags]
 */
import { readFileSync } from "node:fs";
import {
  ElectrumClient,
  HDWallet,
  photonsToRxd,
  radiantjs,
  DUST_LIMIT,
  buildTx,
  ftScript,
  nftScript,
  selectRxdFunding,
  parseFtScript,
  parseNftScript,
  mintFT,
  mintNFT,
} from "@radiant-core/sdk";
import {
  scanTokens,
  tokenFreeFunding,
  estimateTokenSendFee,
  sendWholeToken,
  sendFtAmount,
} from "../src/lib/glyphs";
import type { ScanResult, ScannedAddress } from "../src/lib/wallet";

const ENDPOINT = process.env.RXD_ENDPOINT || "wss://rxdexplorer.com";
const TEST_VECTOR =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const opt = (n: string) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};

const MINT = flag("--mint");
const MINT_FT = flag("--mint-ft");
const BROADCAST = flag("--broadcast");
const CONFIRMED = process.env.RXD_SEND_CONFIRM === "SEND";
const TO = opt("--to");
const AMOUNT = opt("--amount");
const TICKER = opt("--ticker") || "LUMEN";
const SUPPLY = BigInt(opt("--supply") || "1000000");

let failures = 0;
const ok = (m: string) => console.log("  OK   " + m);
const info = (m: string) => console.log("       " + m);
const fail = (m: string) => {
  console.log("  FAIL " + m);
  failures++;
};

let mnemonic = process.env.RXD_MNEMONIC;
let source = "env RXD_MNEMONIC";
const mf = opt("--mnemonic-file");
if (!mnemonic && mf) {
  mnemonic = readFileSync(mf, "utf8").trim();
  source = `file ${mf}`;
}
if (!mnemonic) {
  mnemonic = TEST_VECTOR;
  source = "PUBLIC TEST VECTOR (not your wallet)";
}
const isTestVector = mnemonic === TEST_VECTOR;
const needsConfirm = MINT || BROADCAST;

console.log(`== Live Glyph mint+send harness ${new Date().toISOString()} ==`);
console.log(`   endpoint : ${ENDPOINT}`);
console.log(`   wallet   : ${source}`);
console.log(`   mint     : ${MINT ? (MINT_FT ? `FT ${TICKER} supply=${SUPPLY}` : "NFT") : "no"}`);
console.log(`   send     : ${BROADCAST ? "BROADCAST" : "DRY-RUN (no broadcast)"}`);
if (needsConfirm && isTestVector) {
  console.log("\nRefusing to mint/broadcast from the public test vector. Supply RXD_MNEMONIC.");
  process.exit(1);
}
if (needsConfirm && !CONFIRMED) {
  console.log("\nMint/broadcast requested but RXD_SEND_CONFIRM!=SEND. Refusing.");
  process.exit(1);
}

const client = new ElectrumClient({ endpoint: ENDPOINT });
await client.connect();
ok(`connected to ${ENDPOINT}`);
info(`server.version -> ${JSON.stringify(await client.serverVersion("rxd-glyph-send", "1.4"))}`);

const wallet = HDWallet.fromMnemonic(mnemonic, { network: "mainnet" });

/** Scan receive+change chains for RXD; returns addresses + a ScanResult. */
async function scanRxd(): Promise<{ addresses: ScannedAddress[]; scan: ScanResult }> {
  const addresses: ScannedAddress[] = [];
  for (const change of [0, 1]) {
    for (let i = 0; i < 20; i++) {
      const key = wallet.deriveKey(i, change);
      const hist = await client.getHistory(key.address).catch(() => []);
      addresses.push({ key, used: hist.length > 0, change });
    }
  }
  const used = addresses.filter((a) => a.used);
  const utxos: any[] = [];
  for (const a of used) {
    const rows = await client.listUnspent(a.key.address).catch(() => []);
    for (const u of rows) {
      utxos.push({
        ...u,
        ownerAddress: a.key.address,
        ownerWif: a.key.wif,
        ownerIndex: a.key.index,
        ownerChange: a.change,
      });
    }
  }
  const total = utxos.reduce((s, u) => s + u.value, 0n);
  const scan = {
    addresses,
    utxos,
    confirmed: total,
    unconfirmed: 0n,
    total,
    tokenUtxoCount: 0,
    nextReceive: wallet.deriveKey(used.length, 0),
    nextChange: wallet.deriveKey(0, 1),
  } as unknown as ScanResult;
  return { addresses, scan };
}

/** Mint a fresh token at the first address that holds token-free RXD funding. */
async function doMint(scan: ScanResult, addresses: ScannedAddress[]) {
  let ownerAddr: string | null = null;
  let ownerWif: string | null = null;
  let funding: ReturnType<typeof tokenFreeFunding> = [];
  for (const a of addresses.filter((x) => x.used)) {
    const f = tokenFreeFunding(scan, a.key.address);
    if (f.length > 0) {
      ownerAddr = a.key.address;
      ownerWif = a.key.wif;
      funding = f;
      break;
    }
  }
  if (!ownerAddr || !ownerWif) {
    fail("no token-free RXD funding at any address — cannot mint (fund the wallet first)");
    return null;
  }
  info(`mint owner: ${ownerAddr} (${funding.length} funding utxo(s), ${photonsToRxd(funding.reduce((s, u) => s + u.value, 0n))} RXD)`);
  const metadata = {
    name: MINT_FT ? `Lumen test ${TICKER}` : "Lumen test glyph",
    desc: "Minted by the live-glyph-send harness for end-to-end validation.",
  };
  try {
    const result = MINT_FT
      ? await mintFT({
          client,
          address: ownerAddr,
          wif: ownerWif,
          fundingUtxos: funding,
          ticker: TICKER,
          supply: SUPPLY,
          metadata,
          feeRate: 10_000n,
          network: "mainnet",
        })
      : await mintNFT({
          client,
          address: ownerAddr,
          wif: ownerWif,
          fundingUtxos: funding,
          metadata,
          feeRate: 10_000n,
          network: "mainnet",
        });
    ok(`minted ${MINT_FT ? "FT" : "NFT"} ref ${result.refDisplay}`);
    info(`commit : https://rxdexplorer.com/tx/${result.commitTxid}`);
    info(`reveal : https://rxdexplorer.com/tx/${result.revealTxid}`);
    return result;
  } catch (e) {
    fail("mint failed: " + (e as Error).message);
    return null;
  }
}

// ------------------------------------------------------------------ main --
console.log("\n[1] RXD scan (receive + change chains)");
let { addresses, scan } = await scanRxd();
info(`${addresses.filter((a) => a.used).length} used address(es), ${scan.utxos.length} RXD utxo(s), total ${photonsToRxd(scan.total)} RXD`);
for (const u of scan.utxos.slice(0, 8)) {
  info(`${u.txid.slice(0, 12)}…:${u.vout} ${photonsToRxd(u.value)} RXD @ ${u.ownerAddress.slice(0, 12)}…`);
}

if (MINT) {
  console.log("\n[2] Mint a fresh token (REAL commit + reveal broadcast)");
  const minted = await doMint(scan, addresses);
  if (!minted) {
    client.close();
    process.exit(1);
  }
  // Give the mempool a moment, then re-scan so the new token + change are visible.
  info("waiting 4s for the reveal to propagate…");
  await new Promise((r) => setTimeout(r, 4000));
  ({ addresses, scan } = await scanRxd());
  info(`re-scan: ${scan.utxos.length} RXD utxo(s), total ${photonsToRxd(scan.total)} RXD`);
}

console.log("\n[3] Glyph token scan (zeroed-ref scripthashes)");
const tokenResult = await scanTokens(client, addresses, { withMetadata: true });
ok(
  `${tokenResult.tokens.length} token(s), ${tokenResult.utxos.length} token utxo(s), ` +
    `locked ${photonsToRxd(tokenResult.lockedPhotons)} RXD`,
);
for (const t of tokenResult.tokens) {
  info(
    `${t.kind.toUpperCase()} ${t.refDisplay} amount=${t.amount} ` +
      `name=${JSON.stringify(t.metadata?.name ?? null)} utxos=${t.utxos.length}`,
  );
}

if (tokenResult.tokens.length === 0) {
  console.log("\nNo tokens in this wallet — nothing to send.");
  console.log("Run with --mint (and a funded wallet) to create one first.");
  client.close();
  process.exit(failures ? 1 : 0);
}

// ------------------------------------------------------------- pick send --
console.log("\n[4] Select token + destination");
const token = tokenResult.tokens[0];
const dest = TO || wallet.deriveKey(1, 0).address;
info(`token   : ${token.kind} ${token.refDisplay}`);
info(`dest    : ${dest}${TO ? "" : "  (default: own receive[1] — self-send)"}`);

const owner = token.utxos[0];
const funding = tokenFreeFunding(scan, owner.ownerAddress);
ok(
  `token-free funding at owner: ${funding.length} utxo(s), ` +
    `${photonsToRxd(funding.reduce((s, u) => s + u.value, 0n))} RXD`,
);
if (funding.length === 0) fail("no token-free RXD at the token's owner address to pay the fee");

const amount = AMOUNT ? BigInt(AMOUNT) : token.amount;
const whole = token.kind === "nft" || amount === token.amount;
info(`amount  : ${amount} (${whole ? "whole" : "partial"})`);

const estFee = estimateTokenSendFee(scan, token, token.kind === "nft" ? null : amount, 10_000n);
info(`est fee : ${estFee === null ? "unavailable" : photonsToRxd(estFee) + " RXD"}`);

if (token.kind === "ft" && amount < DUST_LIMIT) {
  fail(`amount ${amount} is below dust limit ${DUST_LIMIT} — would be unspendable`);
}

// ------------------------------------------------- build / sign / verify --
console.log("\n[5] Build + sign" + (BROADCAST ? " + BROADCAST" : " (dry-run, NOT broadcast)"));

if (!BROADCAST) {
  const feeRate = 10_000n;
  let inputs: { txid: string; vout: number; value: bigint; script: string }[];
  let outputs: { script: string; value: bigint }[];
  if (token.kind === "nft") {
    const sel = selectRxdFunding(funding, 0n, feeRate, {
      baseOutputCount: 1,
      extraInputBytes: 148n,
      withChange: true,
    });
    inputs = [
      { txid: owner.txid, vout: owner.vout, value: owner.value, script: owner.script },
      ...sel.inputs.map((u) => ({ txid: u.txid, vout: u.vout, value: u.value, script: u.script })),
    ];
    outputs = [{ script: nftScript(dest, token.ref), value: owner.value }];
  } else {
    const sorted = [...token.utxos].sort((a, b) => (a.value < b.value ? 1 : a.value > b.value ? -1 : 0));
    const spend: typeof token.utxos = [];
    let sum = 0n;
    for (const u of sorted) {
      spend.push(u);
      sum += u.value;
      if (sum >= amount) break;
    }
    const change = sum - amount;
    outputs = [{ script: ftScript(dest, token.ref), value: amount }];
    if (change > 0n) outputs.push({ script: ftScript(owner.ownerAddress, token.ref), value: change });
    const sel = selectRxdFunding(funding, 0n, feeRate, {
      baseOutputCount: outputs.length,
      extraInputBytes: BigInt(148 * spend.length),
      withChange: true,
    });
    inputs = [
      ...spend.map((u) => ({ txid: u.txid, vout: u.vout, value: u.value, script: u.script })),
      ...sel.inputs.map((u) => ({ txid: u.txid, vout: u.vout, value: u.value, script: u.script })),
    ];
  }
  const built = buildTx({
    address: owner.ownerAddress,
    wif: owner.ownerWif,
    inputs,
    outputs,
    addChange: true,
    feeRate,
    network: "mainnet",
  });
  ok(`built tx ${built.txid}`);
  info(`hex ${built.hex.length} chars, ${inputs.length} input(s), ${built.outputs.length} output(s)`);

  const tx = new radiantjs.Transaction(built.hex);
  let tokenOuts = 0;
  tx.outputs.forEach((o: any, i: number) => {
    const s = o.script.toHex();
    if (parseNftScript(s).ref || parseFtScript(s).ref) tokenOuts++;
    info(`  out[${i}] ${o.satoshis} photons ${s.slice(0, 32)}…`);
  });
  if (tokenOuts >= 1) ok(`transaction carries ${tokenOuts} token output(s) — token preserved, not burned`);
  else fail("no token output found — this would BURN the token");

  const inSum = inputs.reduce((s, u) => s + u.value, 0n);
  const outSum = tx.outputs.reduce((s: bigint, o: any) => s + BigInt(o.satoshis), 0n);
  const fee = inSum - outSum;
  info(`fee = ${photonsToRxd(fee)} RXD`);
  if (fee >= 0n) ok("fee is non-negative");
  else fail("negative fee — malformed transaction");

  console.log("\nDRY-RUN complete. To broadcast the send for real:");
  console.log("  set RXD_MNEMONIC=<your phrase> and RXD_SEND_CONFIRM=SEND");
  console.log(`  npm run live:glyph -- --to ${dest} --broadcast`);
} else {
  try {
    const sent = whole
      ? await sendWholeToken({ client, scan, token, to: dest, feeRate: 10_000n, network: "mainnet" })
      : await sendFtAmount({ client, scan, token, to: dest, amount, feeRate: 10_000n, network: "mainnet" });
    ok(`BROADCAST txid ${sent.txid}`);
    info(`ref ${sent.ref} sent ${sent.sent}`);
    info(`explorer: https://rxdexplorer.com/tx/${sent.txid}`);
    await new Promise((r) => setTimeout(r, 3000));
    const after = await scanTokens(client, addresses, { withMetadata: false });
    const still = after.tokens.find((t) => t.ref === token.ref);
    if (token.kind === "nft" && !still) ok("NFT no longer in wallet — transfer confirmed on-chain");
    else if (token.kind === "ft") info(`FT balance now ${still ? still.amount : 0n}`);
    else fail("NFT still present after broadcast — check the explorer");
  } catch (e) {
    fail("broadcast failed: " + (e as Error).message);
  }
}

client.close();
console.log(`\n${failures === 0 ? "All checks passed" : failures + " check(s) FAILED"} -> exit ${failures ? 1 : 0}`);
process.exit(failures ? 1 : 0);


