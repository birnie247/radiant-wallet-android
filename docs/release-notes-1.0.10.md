Self-custody wallet for [Radiant](https://radiantblockchain.org) (RXD) on Android. The
recovery phrase is generated, encrypted and used to sign entirely on the device — no
server ever sees a private key.

## Install

**On the phone:** download `radiant-wallet-1.0.10.apk` below, tap it, and allow
"install unknown apps" for whichever app opens it (Files, Chrome, Drive).

**Over USB:**

```bash
adb install -r radiant-wallet-1.0.10.apk
```

Requires **Android 8.0+** (minSdk 26). Package `org.radiant.wallet`.

Install the same way to update: the signing key is unchanged, so your wallet survives.
If you ever see `INSTALL_FAILED_UPDATE_INCOMPATIBLE`, the installed copy was signed by
a different key — uninstall first, which **erases the local vault**, so restore from
your 12 words afterwards.

## Verify what you downloaded

| | |
| --- | --- |
| File | `radiant-wallet-1.0.10.apk` |
| Size | 1,742,309 bytes (1.66 MB) |
| SHA-256 | `45c7749cde019df551293b4d5b238ec20116f7c640b437ae699d493d7abc563f` |
| versionName / Code | 1.0.10 / 10010 |
| Signed by | `CN=Birnie, O=Radiant Wallet, C=CA` |
| Cert SHA-256 | `0705003465f23d4a65ed6aafc4949cb7a2eb3246167ebf7f5c85f3c51f11ccc6` |
| Scheme | APK Signature v2 + v3, not debuggable |

```bash
sha256sum radiant-wallet-1.0.10.apk
apksigner verify --print-certs radiant-wallet-1.0.10.apk
```

## Honest status

This is **unaudited software handling real money**, built as a personal project and
published so it can be inspected. Read this before trusting it with anything you care
about:

- **Broadcast has never been exercised with real funds.** Everything up to and
  including a valid signature is verified against mainnet, including a
  deliberately-wrong-address test and the ref-burn guard. Treat your first send as a
  test: start small.
- **No SPV.** Balances, history and confirmation counts come from a single ElectrumX
  server with no merkle-proof or proof-of-work verification. It cannot steal — it
  never sees a key — but it can lie about state. Treat it as a semi-trusted view.
- **Unproven against a hostile device.** Seed protection is real (AES-256-GCM,
  PBKDF2-SHA256 600k, 12-character minimum, AndroidKeyStore-backed biometric unlock
  with `BIOMETRIC_STRONG`), but keys live in the WebView's JS heap while unlocked —
  the same exposure as any JavaScript wallet.

## What it does

- Create or restore a wallet (BIP39, 12/15/18/21/24 words), BIP44 `m/44'/512'`
- Send RXD with a review step; every payment re-confirmed by passphrase or biometric
- Ref-safe coin selection — a Glyph-bearing UTXO is never spent as fee funding
- Live balance via Electrum push subscriptions, with a 60 s backstop poll
- History with confirmation counts; tap any row to open it on
  [radiantexplorer.com](https://radiantexplorer.com)
- Optional RXD/USD value (CoinGecko, 2-minute cache, opt-out)
- Auto-lock when the app leaves the foreground, screenshots blocked by default
- **No telemetry, no analytics, no accounts, no backend.** The only outbound requests
  are to Electrum servers, the block explorer you open yourself, and — only if you
  leave the toggle on — a price API that receives nothing but the coin id.

Not implemented: QR **scanning**, Glyph tokens, WAVE names. Mainnet only (every
testnet endpoint is dead).

## Source

Built from commit [`9500640`](https://github.com/birnie247/radiant-wallet-android/tree/9500640).
MIT licensed, with the Radiant artwork under Apache-2.0. Full documentation,
security model and limitations are in the [README](https://github.com/birnie247/radiant-wallet-android#readme).
