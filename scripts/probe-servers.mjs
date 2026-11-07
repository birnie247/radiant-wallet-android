// Probe Photonic Wallet's production ElectrumX WebSocket endpoints in parallel.
import WebSocket from "ws";

// Keep this list in step with SERVERS.mainnet in src/lib/servers.ts.
//
// Ports matter: these servers also expose raw TCP ElectrumX (50001/50002/50012)
// and a host answering there is NOT necessarily usable, because the wallet speaks
// WebSocket. Only a port that completes the HTTP upgrade *and* answers JSON-RPC
// counts as live here.
const MAINNET = [
  "wss://electrumx.radiant4people.com:50022",
  "wss://electrumx2.radiant4people.com:50022",
  "wss://electrumx.radiantcore.org:443",
];

// Testnet support was removed from the app. This stays only so the script can be
// pointed at the old host with `npm run probe testnet`.
const TESTNET = ["wss://electrumx-testnet.radiant4people.com:53002"];

const SH =
  "59dea47da05ec1d2ecf6ed312b523926c7ac1058860dcf2bfe3338ce4495d1e6";

function probe(url, timeoutMs = 9000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let settled = false;
    const fin = (r) => {
      if (settled) return;
      settled = true;
      try { ws.terminate(); } catch {}
      resolve({ url, ms: Date.now() - t0, ...r });
    };
    let ws;
    try {
      ws = new WebSocket(url, { handshakeTimeout: timeoutMs, rejectUnauthorized: false });
    } catch (e) {
      return resolve({ url, ms: 0, ok: false, err: "ctor:" + e.message });
    }
    ws.on("open", () => {
      ws.send(JSON.stringify({ id: 1, method: "server.version", params: ["rxd-wallet-probe", "1.4"] }));
      ws.send(JSON.stringify({ id: 2, method: "blockchain.scripthash.get_balance", params: [SH] }));
    });
    ws.on("message", (m) => {
      const s = String(m);
      try {
        const j = JSON.parse(s);
        if (j.id === 1) fin({ ok: true, server: j.result });
        if (j.id === 2) fin({ ok: true, balance: j.result });
      } catch { /* ignore */ }
    });
    ws.on("unexpected-response", (_q, res) => fin({ ok: false, err: `HTTP ${res.statusCode}` }));
    ws.on("error", (e) => fin({ ok: false, err: e.code || e.message }));
    setTimeout(() => fin({ ok: false, err: "timeout" }), timeoutMs);
  });
}

const which = process.argv[2] === "testnet" ? TESTNET : MAINNET;
const results = await Promise.all(which.map((u) => probe(u)));
for (const r of results) {
  console.log(
    `${r.ok ? "OK  " : "FAIL"} ${r.url.padEnd(46)} ${String(r.ms).padStart(5)}ms  ` +
      (r.ok ? JSON.stringify(r.server ?? r.balance) : r.err),
  );
}
const live = results.filter((r) => r.ok);
console.log(`\n${live.length}/${results.length} live`);
process.exit(0);
