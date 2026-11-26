**Lumen RXD Wallet 1.3.0** — a small, focused release: Recent Activity shows only the
newest transaction until you ask for the rest, and every address under *Funds by
address* copies when you tap it.

## ⚠️ This build is signed by a new key

The upload key that signed 1.0.13–1.2.0 no longer exists — the machine holding it is
gone. 1.3.0 is signed by a **new** 4096-bit key (SHA-256
`84f7a01f…f1075e56`), which has one unavoidable consequence:

- an installed 1.2.0-or-older build **cannot** be updated in place — Android refuses a
  package whose signing certificate differs, with `INSTALL_FAILED_UPDATE_INCOMPATIBLE`;
- uninstalling the old app to make room for this one **erases the encrypted vault**, so
  have your **12/24 words** ready before you start:

```
1. open the old app → Settings → reveal/back up your recovery phrase (or use the copy
   you wrote down)
2. uninstall the old app
3. install this APK
4. "Restore from recovery phrase", enter the words
   — tick "This is a v1 seed" only if the balance comes up empty without it
```

Play is unaffected: 1.2.0 was never uploaded, so Play App Signing has no key on record
for `com.rxdexplorer.lumen`. If you upload this AAB as the first release, the key above
simply becomes the registered upload key.

## Install

Download `lumen-rxd-wallet-1.3.0.apk` below and tap it, or:

```bash
adb install -r lumen-rxd-wallet-1.3.0.apk
```

Requires **Android 9+** (minSdk 28).

## Verify what you downloaded

| | |
| --- | --- |
| File | `lumen-rxd-wallet-1.3.0.apk` |
| Size | 2,184,015 bytes (2.08 MB) |
| SHA-256 | `7ccbe23f2240dd9fd6c9cf1bdd0a0ec2a26da999edec2a16ce325c565d9179ba` |
| versionName / Code | 1.3.0 / 10300 |
| Package | `com.rxdexplorer.lumen` |
| Signed by | `CN=Birnie, O=Lumen RXD Wallet, C=CA` |
| Cert SHA-256 | `84f7a01f0e4987f28354767e2c3dc53284fec1a033864bc39b982b28f1075e56` |
| Scheme | APK Signature **v3** only, not debuggable |

```bash
sha256sum lumen-rxd-wallet-1.3.0.apk
apksigner verify --print-certs lumen-rxd-wallet-1.3.0.apk
```

## What changed

- **Recent Activity is collapsed to the one transaction that matters.** The newest
  entry is shown, with a `Show last N` button underneath — N is however many entries are
  in hand, capped at 25 — that expands to the rest of the session's history, and a
  `Show latest only` button that folds it back. The count is stated honestly —
  `Latest of 47 transactions.` collapsed, `Showing the 25 most recent of 47
  transactions.` expanded — because history is fetched 25 at a time and the panel should
  not imply it holds everything. Collapsing is UI only: no extra server calls, and each
  row still opens the txid in a block explorer.
- **Funds by address rows copy the address.** Tap a row and the full address goes to
  the clipboard; the row shows `copied ✓` for 1.6 seconds. Long-press/mouse hover still
  shows the full address as a tooltip, and the label stays ellipsised. The `copy` badge
  only appears on rows that have a balance, which is also the only place an address is
  worth taking.
- **The clipboard path is now shared and honest.** `src/lib/clipboard.ts` tries
  `navigator.clipboard` and falls back to a hidden textarea + `execCommand("copy")` for
  older WebViews, and **returns whether the write actually succeeded**. Receive's copy
  button was refactored onto it, so neither screen can claim "copied" when the WebView
  silently refused.

Nothing else changed: same package, same permissions, same servers, same vault format.

## Play Store

`lumen-rxd-wallet-1.3.0.aab` is attached for Play Console upload (Internal testing):

| | |
| --- | --- |
| File | `lumen-rxd-wallet-1.3.0.aab` |
| Size | 2,123,241 bytes (2.02 MB) |
| SHA-256 | `85d0d9e2093c8c3569adb55e212c2db4456ba07faa2577c4b0d75b3a45152eea` |
| versionCode | 10300 |
| targetSdk / minSdk | 36 / 28 |

Play re-signs the bundle with the app-signing key it holds; the `84f7a01f…` key above
is only the upload key. A Play-signed install and a GitHub APK are different signers of
the same package, so a device cannot move between the two channels without uninstalling
— which erases the vault. Pick a channel and stay on it.

## Privacy — unchanged

No backend, no analytics, no accounts. The default ElectrumX endpoint,
`wss://rxdexplorer.com`, is run by the developer, so **by default it sees your IP
address and the addresses your wallet queries**. It never sees your phrase, keys or
passphrase. Settings → ElectrumX server switches it or adds your own, and the choice is
remembered. The [1.2.0 notes](https://github.com/birnie247/radiant-wallet-android/releases/tag/v1.2.0)
have the full statement.

## Honest status

Unaudited software handling real money. One real mainnet send has succeeded with this
build line. SPV covers headers, checkpointed linkage and merkle inclusion, but not the
per-block difficulty rule; balances still come from a single server, which cannot steal
but can misreport state. Not implemented: QR scanning, Glyph tokens, WAVE names,
background push notifications. Mainnet only.

## Source

Built from tag [`v1.3.0`](https://github.com/birnie247/radiant-wallet-android/tree/v1.3.0).
MIT licensed, with the Radiant artwork under Apache-2.0.
