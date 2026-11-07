Self-custody wallet for [Radiant](https://radiantblockchain.org) (RXD) on Android. The
recovery phrase is generated, encrypted and used to sign entirely on the device — no
server ever sees a private key.

## ⚠️ New signing key in this release

1.0.13 is signed by a **newly generated key**, because the key that signed 1.0.10–1.0.12
was not available on the machine this build was made on. Android keys identity by
signature, so this APK **will not install over 1.0.12**:

```bash
adb install -r radiant-wallet-1.0.13.apk
# Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: ... signatures do not match]
```

To move to 1.0.13 you must **uninstall first**, which deletes the local vault — so have
your **12/24 words** ready and restore after installing:

```bash
adb uninstall org.radiant.wallet
adb install radiant-wallet-1.0.13.apk
```

On the phone: long-press the app → Uninstall → install the APK → *Restore from recovery
phrase*. Same wallet, same addresses, same funds — only the local encrypted copy is
rebuilt. Every release from here on can be signed with this key, so 1.0.13 → 1.0.14 will
update in place again.

## Install

**On the phone:** download `radiant-wallet-1.0.13.apk` below, tap it, and allow
"install unknown apps" for whichever app opens it (Files, Chrome, Drive).

**Over USB:**

```bash
adb install -r radiant-wallet-1.0.13.apk
```

Requires **Android 8.0+** (minSdk 26). Package `org.radiant.wallet`.

## Verify what you downloaded

| | |
| --- | --- |
| File | `radiant-wallet-1.0.13.apk` |
| Size | 1,747,070 bytes (1.67 MB) |
| SHA-256 | `8b7f60290a1a0320ce6051bf7bfb37d055b4ce00405b970c242f1a83534f8a87` |
| versionName / Code | 1.0.13 / 10013 |
| Signed by | `CN=Birnie, O=Radiant Wallet, C=CA` |
| Cert SHA-256 | `226f0d84348ee46a80d5bb919fa3564e00222785071565584028d6206d725a7d` |
| Scheme | APK Signature v2 + v3, not debuggable |

```bash
sha256sum radiant-wallet-1.0.13.apk
apksigner verify --print-certs radiant-wallet-1.0.13.apk
```

## What's new

**Your own ElectrumX servers (new).** Settings → ElectrumX server is now a list you
own, not a fixed set:

- **Add** an endpoint of your own. Input is validated and normalised: `wss://` only
  (`ws://` is blocked as mixed content and could never connect), no path or credentials,
  and a bare `host:port` is treated as `wss://host:port`.
- **Test connection** runs a real `server.version` handshake against that one host and
  shows what answered and how fast (e.g. *“ElectrumX 1.3.0 in 1181 ms”*). A server that
  passes is marked *verified* and used immediately; one you don't test is added but left
  inactive, so a typo cannot silently take over the connection.
- **Remove** any entry. Removing a built-in server *hides* it (restorable with
  *Restore built-in servers*); removing your own deletes it. The last remaining server
  cannot be removed, and removing the one you are connected to reconnects automatically.
- Added servers sit **after** the built-in ones in the automatic connect order, so a dead
  custom host never adds delay while a known-good server answers — tap **Use** to prefer it.
- Both lists live in `localStorage`, not in the encrypted vault: a server address is not
  a secret, and switching must never ask for the passphrase. Everything read back is
  re-validated, so a hand-edited `ws://` entry cannot sneak in.

Also since 1.0.10 (if you are coming from that release): SPV header verification with
chain linkage and merkle inclusion proofs, and a count of how many displayed transactions
were actually proven.

## Honest status

This is **unaudited software handling real money**, built as a personal project and
published so it can be inspected:

- **One real mainnet send has succeeded** (owner-verified, broadcast from this build
  line). Everything up to and including a valid signature is verified against mainnet,
  including a deliberately-wrong-address test and the ref-burn guard. One send is not a
  track record — treat your first send as a test and start small.
- **SPV is partial.** Headers, chain linkage and merkle proofs are verified against live
  mainnet; the per-block difficulty adjustment is the last missing piece. Balances and
  history still come from one ElectrumX server, which can lie about state but cannot steal
  — it never sees a key. Two independent operators' tips are cross-checked.
- **Unproven against a hostile device.** Seed protection is real (AES-256-GCM,
  PBKDF2-SHA256 600k, 12-character minimum, AndroidKeyStore-backed biometric unlock with
  `BIOMETRIC_STRONG`), but keys live in the WebView's JS heap while unlocked — the same
  exposure as any JavaScript wallet.

## What it does

- Create or restore a wallet (BIP39, 12/15/18/21/24 words), BIP44 `m/44'/512'`
- Send RXD with a review step; every payment re-confirmed by passphrase or biometric
- Ref-safe coin selection — a Glyph-bearing UTXO is never spent as fee funding
- Live balance via Electrum push subscriptions, with a 60 s backstop poll
- History with confirmation counts and SPV proofs; tap a row to open it on
  [radiantexplorer.com](https://radiantexplorer.com)
- Choose, add, test and remove ElectrumX servers
- Optional RXD/USD value (CoinGecko, 2-minute cache, opt-out)
- Auto-lock when the app leaves the foreground, screenshots blocked by default
- **No telemetry, no analytics, no accounts, no backend.** The only outbound requests are
  to Electrum servers, the block explorer you open yourself, and — only if you leave the
  toggle on — a price API that receives nothing but the coin id.

Not implemented: QR **scanning**, Glyph tokens, WAVE names. Mainnet only (every testnet
endpoint is dead).

## Source

Built from commit
[`235743b`](https://github.com/birnie247/radiant-wallet-android/tree/235743b).
MIT licensed, with the Radiant artwork under Apache-2.0. Full documentation, security
model and limitations are in the
[README](https://github.com/birnie247/radiant-wallet-android#readme).
