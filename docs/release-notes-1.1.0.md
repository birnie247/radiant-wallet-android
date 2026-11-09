**Lumen RXD Wallet** — self-custody wallet for [Radiant](https://radiantblockchain.org)
(RXD) on Android. The recovery phrase is generated, encrypted and used to sign entirely
on the device; no server ever sees a private key.

The app is the same app: package `org.radiant.wallet`, same signing key as 1.0.13, so
this **updates in place and keeps your wallet**. Only the name and the icon label changed.

## Upgrading from an older version

| From | What to do |
| --- | --- |
| **1.0.13** | Nothing special — `adb install -r`, or tap the APK. The signing key is unchanged, so the wallet survives. |
| **1.0.12 or older** | Those were signed with a retired key, so Android refuses the update: uninstall first (which erases the local vault), then restore from your recovery phrase. See the [1.0.13 notes](https://github.com/birnie247/radiant-wallet-android/releases/tag/v1.0.13). |

The APK is now named `lumen-rxd-wallet-1.1.0.apk` (it was `radiant-wallet-…`). Old links
still resolve; the file inside is the same product.

## Install

**On the phone:** download `lumen-rxd-wallet-1.1.0.apk` below, tap it, and allow
"install unknown apps" for whichever app opens it.

**Over USB:**

```bash
adb install -r lumen-rxd-wallet-1.1.0.apk
```

Requires **Android 8.0+** (minSdk 26).

## Verify what you downloaded

| | |
| --- | --- |
| File | `lumen-rxd-wallet-1.1.0.apk` |
| Size | 1,747,316 bytes (1.67 MB) |
| SHA-256 | `5fcbf4ed65253c2a15423d32a8e6389989ddbb6ec12689c20e2b36a387ce2674` |
| versionName / Code | 1.1.0 / 10100 |
| Signed by | `CN=Birnie, O=Radiant Wallet, C=CA` |
| Cert SHA-256 | `226f0d84348ee46a80d5bb919fa3564e00222785071565584028d6206d725a7d` |
| Scheme | APK Signature v2 + v3, not debuggable |

The certificate fingerprint is the same as 1.0.13 — that is what makes the in-place
update possible.

```bash
sha256sum lumen-rxd-wallet-1.1.0.apk
apksigner verify --print-certs lumen-rxd-wallet-1.1.0.apk
```

## What's new

**New name: Lumen RXD Wallet.** Launcher label, in-app branding and the APK name all
changed. Nothing else about the app's identity did — package id, signing key and update
path are untouched.

**Restore a v1 seed.** A coin type is part of the derivation path, so the same BIP39
phrase produces a different address set at `m/44'/0'` than at `m/44'/512'`. The restore
screen now has a **“This is a v1 seed”** checkbox:

- unticked (default) → `m/44'/512'`, every wallet this app creates;
- ticked → `m/44'/0'`, for phrases from wallets made before Radiant's coin type existed.

The choice is stored in the encrypted vault, so every later unlock derives the same
addresses, and Settings → About shows the live path plus a **v1 seed** badge. Ticking it
for a modern seed shows an empty wallet, and leaving it unticked for a v1 seed does the
same — the flag is the difference between “restored” and “restored, then found its
funds”.

**New default server: `wss://rxdexplorer.com`.** A fresh install now connects here
first: ElectrumX 1.4.1, ~315 ms, and its `genesis_hash` matches the one pinned in this
build, so it is verifiably on the Radiant chain. The other three endpoints are still
listed and still tried in order if this one is unreachable, and *Settings → ElectrumX
server* lets you pick any of them, add your own, or remove one.

> **This default is run by the wallet's maintainer.** That is worth saying plainly: a
> fresh install sends its address cluster, and its IP, to the project's own box — exactly
> what any Electrum server sees, and never a key or the phrase. The tip cross-check still
> compares it against `radiant4people.com` and `radiantcore.org`, two operators this
> project has no part in. Want zero dependence on the maintainer? Tap **Use** on either of
> those; the choice is remembered. The app stores nothing on the server beyond the
> ordinary ElectrumX session.

Still from 1.0.13, if you missed it: *Settings → ElectrumX server* is a list you own —
add an endpoint, **test** it with a real handshake, remove any entry (built-ins are
hidden, not deleted, and restorable), with the last server protected so the wallet can
never end up with nowhere to connect.

## Honest status

Unaudited software handling real money.

- **One real mainnet send has succeeded** (owner-verified). Everything up to and including
  a valid signature is verified against mainnet, including a deliberately wrong address
  and the ref-burn guard. One send is not a track record — start small.
- **SPV is partial.** Headers, checkpointed chain linkage and merkle inclusion proofs are
  verified against live mainnet; the per-block difficulty adjustment is the last missing
  piece. Balances and history still come from one ElectrumX server, which can lie about
  state but cannot steal — it never sees a key.
- **The default server is the maintainer's**, as described above. Switch if that matters
  to you.
- **Unproven against a hostile device.** Seed protection is real (AES-256-GCM,
  PBKDF2-SHA256 600k, 12-character minimum, AndroidKeyStore-backed biometric unlock with
  `BIOMETRIC_STRONG`), but keys live in the WebView's JS heap while unlocked.

Not implemented: QR **scanning**, Glyph tokens, WAVE names, background push notifications.
Mainnet only.

## Source

Built from commit
[`54b4cfe`](https://github.com/birnie247/radiant-wallet-android/tree/54b4cfe).
MIT licensed, with the Radiant artwork under Apache-2.0. Full documentation, security
model and limitations are in the
[README](https://github.com/birnie247/radiant-wallet-android#readme).
