**Lumen RXD Wallet 1.2.0** — the release that moves the app to its Play Store identity,
and **the last GitHub APK**: once the Play listing is accepted, Play becomes the primary
channel and APK releases stop.

## ⚠️ This one is a *new app* to Android

The package id changed from `org.radiant.wallet` to **`com.rxdexplorer.lumen`**. Android
identifies an app by package plus signer, so this build:

- installs alongside the old app rather than over it — nothing is transferred;
- needs your **12/24 words** to bring the wallet across;
- leaves the old app (and its vault) on the device until you uninstall it.

```
1. install this APK (or update from Play once it is live)
2. choose "Restore from recovery phrase", enter your words
   — tick "This is a v1 seed" only if the balance comes up empty without it
3. once the balance is right, uninstall the old "Lumen RXD Wallet"/"Radiant Wallet"
   entry if it is still on the phone
```

The signing key is unchanged (same certificate as 1.0.13–1.1.1), but a package change
means Android sees a different app, so the old copy's data does not carry over.

## Install

Download `lumen-rxd-wallet-1.2.0.apk` below and tap it, or:

```bash
adb install -r lumen-rxd-wallet-1.2.0.apk
```

Requires **Android 9+** (minSdk 28 — raised from 26, because API 26–27 devices can ship
a WebView too old for the app's BigInt arithmetic, which showed up as a "failed to
start" screen).

## Verify what you downloaded

| | |
| --- | --- |
| File | `lumen-rxd-wallet-1.2.0.apk` |
| Size | 2,183,640 bytes (2.08 MB) |
| SHA-256 | `af055a2ac663f8effeb5c9050ac5f2a1627a7221dd0452b6144d0feeb0b1b4b0` |
| versionName / Code | 1.2.0 / 10200 |
| Package | `com.rxdexplorer.lumen` |
| Signed by | `CN=Birnie, O=Radiant Wallet, C=CA` |
| Cert SHA-256 | `226f0d84348ee46a80d5bb919fa3564e00222785071565584028d6206d725a7d` |
| Scheme | APK Signature **v3** only, not debuggable |

v3-only is deliberate, not a downgrade: with `minSdk 28` every device that can install
this reads v3, so the v2 block that API 24–27 needed is gone.

```bash
sha256sum lumen-rxd-wallet-1.2.0.apk
apksigner verify --print-certs lumen-rxd-wallet-1.2.0.apk
```

## What's in it

Everything from 1.1.x, under the new identity:

- **Restore a v1 seed** — a checkbox on the restore screen derives the old `m/44'/0'`
  path, for phrases from wallets made before Radiant's coin type existed. The choice is
  stored in the vault, and Settings → About shows the live path plus a `v1 seed` badge.
- **Your own ElectrumX servers** — add, test with a real handshake, remove; built-ins
  are hidden rather than deleted, the last server cannot be removed, and a dead server
  falls through to the next.
- **`wss://rxdexplorer.com` as the default**, with the tip cross-check now comparing
  against two **distinct** operators instead of two hosts of one administrator.
- **Android 9+**, themed (monochrome) launcher icon, and the unused legacy
  `USE_FINGERPRINT` permission stripped from the manifest.

## Privacy — same honesty, now in the store listing too

The app has no backend, no analytics and no accounts. But it ships with a default
ElectrumX endpoint, `rxdexplorer.com`, run by the developer: **by default the
developer's server sees your IP address and the addresses your wallet queries.** It never
sees your phrase, keys or passphrase. Settings → ElectrumX server switches it, or adds
your own, and the choice is remembered.

## Channel policy

| Channel | Signer | Updatable by |
| --- | --- | --- |
| This APK | your upload key (`226f0d84…`) | every future APK release |
| Play Store (once accepted) | a Google-held app-signing key | Play only |

They are different signers of the same package, so a device cannot move between them
without uninstalling — which erases the local vault. Pick a channel and stay on it. After
Play accepts the app, GitHub APK releases stop.

## Honest status

Unaudited software handling real money. One real mainnet send has succeeded with this
build line. SPV covers headers, checkpointed linkage and merkle inclusion, but not the
per-block difficulty rule; balances still come from a single server, which cannot steal
but can misreport state. Not implemented: QR scanning, Glyph tokens, WAVE names,
background push notifications. Mainnet only. The [1.1.1](https://github.com/birnie247/radiant-wallet-android/releases/tag/v1.1.1)
and [1.1.0](https://github.com/birnie247/radiant-wallet-android/releases/tag/v1.1.0) notes
have the detail behind each change.

## Source

Built from commit
[`30cea71`](https://github.com/birnie247/radiant-wallet-android/tree/30cea71).
MIT licensed, with the Radiant artwork under Apache-2.0.
