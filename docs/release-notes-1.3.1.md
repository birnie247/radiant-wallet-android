**Lumen RXD Wallet 1.3.1** — a fixes-only release for the one complaint that
mattered: *"I restored my wallet and my funds are not there."* They were there,
on a different address set. Restore now works that out by itself, and Settings can
fix a wallet that already landed on the wrong one.

## What was wrong

A SLIP-44 coin type is part of the BIP44 path, so the same 12/24 words derive two
**completely disjoint** address sets:

| | Path | Who used it |
| --- | --- | --- |
| Current | `m/44'/512'/0'/change/index` | wallets created in Lumen |
| Older | `m/44'/0'/0'/change/index` | Radiant wallets made before coin type 512 was the default |

1.3.0 and earlier picked the older set only if you ticked a checkbox labelled
*"This is a v1 seed"* while restoring. Miss it — and the wording did not help — and
the wallet opens empty: correct phrase, correct app, zero balance, no way to
switch afterwards without deleting the vault.

## What 1.3.1 does

- **Restore auto-detects the address set.** Before you choose a passphrase, the
  app derives the first 20 addresses of the receive *and* change chain for both
  coin types and asks the server which ones have history — 80 lookups, a couple of
  seconds. The change chain matters: a wallet that has only ever *sent* keeps its
  remaining funds on `…/1/i`, and checking only receive addresses would call a
  funded seed empty. The result is stated on the passphrase step in plain words.
- **It never guesses silently.** If neither set shows activity, or no server can be
  reached, the wallet stays on `m/44'/512'` and says exactly that — so "no activity
  found" and "couldn't check" are never confused.
- **Settings → Derivation → Switch address set.** For wallets restored before this
  build, or funded after it. Requires the passphrase, then re-derives and rescans,
  and only after the scan succeeds re-encrypts the vault with the new value — a
  wrong passphrase or an unreachable server leaves everything as it was. It signs,
  sends and moves nothing: funds on the other set stay on-chain and reappear when
  you switch back. The section shows the live path and a `legacy` badge, so the
  scheme is never a mystery.
- **Home no longer undercounts addresses.** The `N addresses` line was reusing a
  list capped at six for display, so a wallet with seven funded addresses read
  "6 addresses". It now counts every used address.
- **The misleading restore checkbox is gone**, replaced by the detection above.

Nothing else changed: same package, permissions, servers and vault format. The only
UI additions are the restore result line and the Settings → Derivation section.

## Install

Download `lumen-rxd-wallet-1.3.1.apk` below and tap it, or:

```bash
adb install -r lumen-rxd-wallet-1.3.1.apk
```

Requires **Android 9+** (minSdk 28). 1.3.1 is signed by the same key as 1.3.0, so
it installs straight over it.

## If your balance is still wrong

1. Settings → Derivation — does the path read `m/44'/512'`?
2. If the wallet came from an older Radiant app, tap **Switch address set…**,
   enter your passphrase, and it will re-derive at `m/44'/0'` and rescan.
3. Sideload users coming from 1.2.0 or older: 1.3.0 introduced a new signing key,
   so the old app must be uninstalled first — which erases the vault. Have your
   recovery phrase in hand. See the
   [1.3.0 notes](https://github.com/birnie247/radiant-wallet-android/releases/tag/v1.3.0).

## Verify what you downloaded

| | |
| --- | --- |
| File | `lumen-rxd-wallet-1.3.1.apk` |
| Size | 2,185,244 bytes (2.08 MB) |
| SHA-256 | `cbd82da3c58bd8bff576e9d62649f32cb1b16dfc4f93015ce35ff079b0d1cbb7` |
| versionName / Code | 1.3.1 / 10301 |
| Package | `com.rxdexplorer.lumen` |
| Signed by | `CN=Birnie, O=Lumen RXD Wallet, C=CA` |
| Cert SHA-256 | `84f7a01f0e4987f28354767e2c3dc53284fec1a033864bc39b982b28f1075e56` (same as 1.3.0) |
| Scheme | APK Signature **v3** |

```bash
sha256sum lumen-rxd-wallet-1.3.1.apk
apksigner verify --print-certs lumen-rxd-wallet-1.3.1.apk
```

## Play Store

`lumen-rxd-wallet-1.3.1.aab` is attached for Play Console upload:

| | |
| --- | --- |
| File | `lumen-rxd-wallet-1.3.1.aab` |
| Size | 2,124,471 bytes (2.03 MB) |
| SHA-256 | `6574376eb2c85bd7d202519807d19be4a4f9023e22561fcedb0986569661882f` |
| versionCode | 10301 |
| Upload key | `84f7a01f…f1075e56` (Play re-signs with its app-signing key) |

## Privacy — unchanged

No backend, no analytics, no accounts. The default ElectrumX endpoint,
`wss://rxdexplorer.com`, is run by the developer, so by default it sees your IP
address and the addresses your wallet queries — during restore that includes the
addresses it probes. It never sees your phrase, keys or passphrase. Settings →
ElectrumX server switches it or adds your own.

## Honest status

Unaudited software handling real money. Balances still come from a single server,
which cannot steal but can misreport state; a server that lies about the *history*
of both address sets would defeat the restore detection, so switch servers and
compare if a restore looks wrong. SPV covers headers, checkpointed linkage and
merkle inclusion, not the per-block difficulty rule. Not implemented: QR scanning,
Glyph tokens, WAVE names, background push notifications. Mainnet only.

## Source

Built from tag [`v1.3.1`](https://github.com/birnie247/radiant-wallet-android/tree/v1.3.1).
MIT licensed, with the Radiant artwork under Apache-2.0.
