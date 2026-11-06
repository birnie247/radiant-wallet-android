# Radiant Wallet — non-custodial RXD for Android

A self-custody wallet for the [Radiant](https://radiantblockchain.org) (RXD)
blockchain. The recovery phrase is generated, encrypted and used to sign
entirely on the device; no server ever sees a private key.

Built with **React + TypeScript + Capacitor**, signing through
[`@radiant-core/sdk`](https://www.npmjs.com/package/@radiant-core/sdk) — the same
library that powers Photonic Wallet — so Radiant's consensus behaviour is the
ecosystem's own proven code rather than a re-implementation.

|  |  |
| --- | --- |
| Version | 1.0.10 |
| Licence | MIT, with Apache-2.0 artwork |
| Android | minSdk 26 · targetSdk 36 |
| Chain access | ElectrumX over WebSocket |
| Distribution | signed APK, sideloaded |

**Contents:** [Status](#status) · [Quick start](#quick-start) ·
[Install and update](#install-and-update) · [How it works](#how-it-works) ·
[Radiant specifics](#radiant-specifics) · [Architecture](#architecture) ·
[Testing](#testing) · [Security](#security) · [Releasing](#releasing) ·
[Known issues and roadmap](#known-issues-and-roadmap) · [Licence](#licence)

> **Just want the app?** Download
> [`radiant-wallet-1.0.10.apk`](https://github.com/birnie247/radiant-wallet-android/releases/latest)
> from Releases and tap it. Read [Before you trust it](#limitations) first — this is
> unaudited software handling real money.

---


## Status

The distinction this repo keeps coming back to is **verified** versus **assumed**.

| Area | Status |
| --- | --- |
| Create wallet (BIP39 12-word) and restore 12–24 words | ✅ verified |
| Seed encrypted at rest (AES-256-GCM, PBKDF2-SHA256 600k, 12-char minimum) | ✅ implemented |
| BIP44 discovery, gap limit 20, receive + change chains | ✅ verified |
| Balance, UTXOs and history over ElectrumX | ✅ verified against mainnet |
| Ref-safe send with review, confirmed by passphrase or biometric | ✅ signing verified offline; passphrase path device-tested |
| Broadcast | ⚠️ implemented, **never exercised with real funds** |
| Live balance updates (server push + backstop poll) | ✅ push accepted by the live server |
| Transaction history with confirmation counts | ✅ verified against synthetic transactions |
| Tap a transaction to open it in a block explorer | ✅ live link returns HTTP 200 |
| Biometric unlock (AndroidKeyStore + BiometricPrompt) | ✅ verified on device, enrol and unlock |
| Screenshots and recording blocked for the seed | ✅ verified on device (`SECURE` window flag) |
| Auto-lock when the app leaves the foreground | ✅ device-tested |
| USD value of the balance | ✅ live API verified, opt-out |
| Mainnet only | ✅ testnet removed — every testnet endpoint is dead |
| QR scanning · Glyph tokens · WAVE names | ❌ not implemented |

> **The one caveat that matters:** no transaction has been broadcast to mainnet
> from this code, because that needs funds. Everything up to and including a valid
> signature is verified. Treat the first real send as a test — start small.

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
```

The app runs in an ordinary browser, so the whole UI is developable without an
emulator — Web Crypto and WebSocket both work over `localhost`.

## Install and update

**Easiest:** grab the APK from
[**Releases**](https://github.com/birnie247/radiant-wallet-android/releases/latest),
copy it to the phone, tap it, and allow "install unknown apps" for whichever app opens
it (Files, Chrome, Drive). Android 8.0+ (minSdk 26), package `org.radiant.wallet`.
Each release lists the size and SHA-256 of the exact bytes, so a download can be
checked before installing.

**Build it yourself —**

```powershell
npm run release      # web build → cap sync → signed APK → signature verified
# → dist-android/radiant-wallet-<version>.apk

C:\Android\Sdk\platform-tools\adb.exe install -r "dist-android\radiant-wallet-1.0.10.apk"
```


**Updating keeps your wallet, as long as the signing key does not change.**
Android identifies an app by package name *plus* signing certificate:

| Situation | Result |
| --- | --- |
| Same keystore, higher `versionCode` | Updates in place; wallet data survives |
| Different or new keystore | Must uninstall first → **local vault erased** |

So back up `android/rxd-release.jks` and `android/keystore.properties` together,
offline. Both are gitignored and must never be committed. The real backup is the
recovery phrase, not the APK. [Releasing](#releasing) covers the keytool command
and versioning.

## How it works

### Chain access

Radiant is read over **ElectrumX WebSocket** endpoints (`wss://`). `connect()`
tries the user's chosen server first, then the curated ones, and the sequence is
budgeted: 7 s per connection, 4 s per handshake, **20 s total**, with no attempt
started while under 3 s of budget remains. A refused connection fails in
milliseconds; a blackholed one in about 2 s.

Failures are phrased for a human — *"Couldn't reach a Radiant mainnet server. Your
connection may be down, or a firewall/VPN may be blocking it."* — and when
`navigator.onLine` is false it says *offline* instead of blaming the servers.

### Live balance updates

Only one part of this is a timer.

1. **Server push (primary).** After each scan the app subscribes
   (`blockchain.scripthash.subscribe`) to every address with history plus the next
   3 unused ones, so a payment to a fresh address also appears without a tap.
2. **Debounce and settle window.** One payment touches several addresses (payment
   plus change), so a burst produces a single re-scan. Notifications in the first
   second after subscribing are ignored — some servers echo the current status on
   subscribe, and treating that as news would create a
   scan→resubscribe→scan loop.
3. **Backstop poll.** A 60 s scan, only while the app is visible, for a server that
   does not push or a socket that died silently.
4. **Manual.** The Refresh button, and once after sending.

Background scans are silent — no "Refreshing…" overlay — so an incoming payment
never interrupts what you were doing. Subscriptions are torn down on lock, on
server switch and on unmount, before the socket closes.

### History and confirmations

`src/lib/history.ts` builds the confirmation-annotated history using standard
ElectrumX calls only (`scripthash.get_history`, `transaction.get`,
`block.header`). Each transaction is resolved against its prevouts to get the
signed net effect — so a send is never displayed as a receive — and
`confirmations = tip − height + 1`, with 0 meaning pending. Block times are read
from the 80-byte header.

Two details here were confirmed empirically: `prevTxId` is **already in display
byte order** (reversing it, the reflex from Bitcoin work, makes every one of your
own spends look like a foreign input), and amounts are `BigInt` photons end to end.

### Explorer links

Tapping a row opens `https://radiantexplorer.com/tx/<txid>` in the system browser.
The URL is built only from a well-formed 64-hex txid, and the native `OpenUrl`
plugin accepts **https on an allowlist of explorer hosts only** — a wallet should
not be a general-purpose intent launcher.

A native plugin, rather than a plain link, because the WebView hardening described
in [Security](#security) disables scripted popups: `window.open()` would silently
do nothing, a bug that only shows up on a phone.

### USD price

The balance card shows an approximate USD value, with a *Show USD value* toggle
and the current unit price in Settings → Display.

- Source: CoinGecko `ids=radiant`, falling back to CoinPaprika. They disagree by
  ~15% because they aggregate different venues, which is exactly why the UI names
  the source instead of implying one authoritative number.
- Cached for 2 minutes; if both providers fail the cached value is shown marked
  `cached`. `fetchRxdUsd()` returns null rather than throwing — a price API being
  down must never affect the wallet.
- RXD trades in fractions of a cent, so anything below 1¢ reads `< $0.01` rather
  than a meaningless `$0.003`.
- **Privacy:** this is the only request to a third party that is not an Electrum
  server. It is opt-out, sends nothing but the coin id, and is disclosed in
  `docs/privacy-policy.html`.

## Security

### What protects the seed

- **At rest.** AES-256-GCM under PBKDF2-SHA256 (600,000 iterations, 16-byte salt,
  12-byte IV); only ciphertext is stored. Minimum passphrase 12 characters with a
  trivially-weak check. Vaults written under the older 310k policy still open and
  are transparently re-encrypted on the next unlock, and stored KDF parameters are
  range-checked rather than trusted.
- **Biometric unlock.** The whole secret blob is *also* encrypted by an
  AES-256-GCM key in the **AndroidKeyStore**, created with
  `setUserAuthenticationRequired(true)`,
  `setInvalidatedByBiometricEnrollment(true)` and `AUTH_BIOMETRIC_STRONG` only. The
  cipher is bound to the prompt through `CryptoObject`, so authenticating and
  decrypting cannot be separated; key material never leaves the TEE, and enrolling
  a new fingerprint invalidates it. The passphrase vault stays the source of truth
  — biometrics are an additional door, never the only one.
- **Leaving the app.** Auto-lock drops the entire session — socket closed, derived
  wallet and UTXOs released — so returning always lands on Unlock. Default is
  *immediately*; Settings allows a 15 s to 15 min grace period. Detection is
  redundant (`visibilitychange`, `pagehide`/`pageshow`, and a frozen-timer
  heartbeat) because a lock that silently stops working is a security failure. A
  lock falling due while a biometric prompt is open is deferred, never dropped.
- **Every payment.** Re-authenticated with the passphrase or a biometric, and the
  secret returned must belong to the wallet on screen, so a stale enrolment or a
  swapped vault cannot sign for a different seed.
- **Screen capture.** `FLAG_SECURE` is raised app-wide by default, with a Settings
  opt-out for QR sharing; the seed screens are always protected by a ref-counted
  holder.
- **WebView.** Remote debugging off in the config *and* in `MainActivity` (the
  config alone is not sufficient — Capacitor applies it only at bridge creation);
  geolocation, scripted popups, multiple windows and form-data retention disabled;
  `allowBackup=false`, `usesCleartextTraffic=false`.

### Static-analysis remediation

| Finding | Status |
| --- | --- |
| HIGH-1 debuggable + WebView debugging | **Fixed** — debugging forced off natively; release builds are `debuggable=false` |
| HIGH-2 debug signing key | **Fixed** — release keystore, R8 + resource shrinking, APK Signature v2 + v3 (`CN=Birnie`). No keystore ⇒ an *unsigned* APK, never a debug-signed one |
| MEDIUM-1 weak passphrase / KDF | **Fixed** — 12-char minimum, PBKDF2 600k, vault schema v2 with transparent upgrade |
| MEDIUM-2 untrusted Electrum server | **Partially** — bare-IP endpoint removed, `verified` gates connect order, cross-operator tip check. **Not SPV** |
| LOW/MED-3 seed resident in heap | **Improved** — per-payment re-auth, session dropped on backgrounding |
| L1 FLAG_SECURE scope | **Fixed** — app-wide by default |
| L2 WebView surface | **Fixed** |
| L3 dev metadata in bundle | **Mitigated** — R8 strips the bytecode; the vendored `package.json` still ships (no secrets) |
| L4 trusted KDF parameters | **Fixed** — range-checked and versioned |

### The honest gap: there is no SPV

Verifying a server's answers means fetching block headers, checking proof-of-work
(Radiant uses SHA-512/256d) and verifying each transaction's merkle branch to a
header. That is substantial, consensus-sensitive work and it is **not
implemented**. What exists is a cheap disagreement check: `crossCheckTip` compares
the chain tip against another operator, bounded to 2 peers × 5 s — and when every
independent operator was offline, that check reported "skipped".

So the app still trusts a single Electrum server for balances, history and
confirmation counts. It cannot steal funds — it never sees a key — but it can
deceive about state. Treat it as a semi-trusted view of the chain.

### Limitations

1. **Broadcast is unproven with real funds** — see [Status](#status).
2. **No SPV**, as above.
3. **Keys live in JS memory** while unlocked. The same class of exposure as any
   JavaScript wallet.
4. **Screenshot blocking is framework-enforced only**: it defeats Android captures
   and MediaProjection recordings and blanks the Recents thumbnail, but not a rooted
   device or someone photographing the screen.
5. **Change consolidates** to the first unused change-chain address rather than a
   fresh one per transaction. It is watched, so funds never strand, but it is weaker
   privacy.
6. **Gap limit 20** (`GAP_LIMIT` in `src/lib/wallet.ts`), with a hard cap of 200.
7. **History is capped** at the 25 most recent transactions, each costing an extra
   request per foreign input.
8. **Not audited.** Standard primitives used carefully, but no third-party review.

## Radiant specifics

Checked against the live chain, Radiant Core's constants and Photonic's production
config. Getting any of these wrong yields a wallet that derives the wrong addresses
or burns tokens.

| Parameter | Value |
| --- | --- |
| Address format | Base58 only — P2PKH `0x00` (`1…`), P2SH `0x05` (`3…`). **No SegWit, no bech32** |
| HD path | `m/44'/512'/account'/change/index` — SLIP-0044 coin type **512** |
| Base unit | 1 RXD = **100,000,000 photons** |
| Signing | `SIGHASH_ALL \| FORKID` = `0x41` |
| Node P2P port | 7333 |

### Refs: where a naive wallet burns tokens

A UTXO holding a Glyph FT/NFT carries an `OP_PUSHINPUTREF`-family opcode
(`0xD0–0xD8`) *inside its output script*. It looks like ordinary spendable value, so
a value-based coin selector will spend it as fee funding and **destroy the token**.
Every funding path here goes through the SDK's `selectRxdFunding`, which screens
candidates by both indexer-reported refs and a local opcode scan, and throws
`TokenBurnGuardError` rather than risk it. Note that a ref is not a trailing
output — a plain P2PKH payment has none.

### Signing order

`buildTx` selects the signing key by **input index**, not by matching the address.
Spending inputs from several addresses therefore requires the WIF array to stay
exactly parallel to the inputs array, or you produce valid-looking transactions with
invalid signatures. `buildPayment` builds both in one pass so they cannot drift, and
`scripts/check-multisign.mjs` proves it against the real signer.

### Servers

Last live probe **2026-11-05** (`npm run probe`):

| Endpoint | Status |
| --- | --- |
| `electrumx.radiant4people.com:50022` | ✅ live, 639 ms |
| `electrumx2.radiant4people.com:50022` | ✅ live, 751 ms |
| `radiant2/radiantus/radiant4.bladenet.online:50022` | ❌ timeout |
| `radiantcore.org:50004` | ❌ timeout |

Only verified endpoints are tried automatically; the dead ones stay listed so they
can be picked deliberately in Settings if they return.

**Testnet was removed.** Every testnet endpoint is gone — `ECONNREFUSED`, or no
longer resolving — so offering the network only produced a confusing failure. The
wallet, and its address validation, are mainnet-only. The historical
`electrum.radiant.ovh` and `electrum.radiantblockchain.org` hosts no longer exist in
DNS; do not reintroduce them.

## Architecture

```
src/
  App.tsx           session state, routing, refresh + re-auth orchestration
  lib/
    wallet.ts       connect, BIP44 scan, UTXO fetch, send build/broadcast
    vault.ts        encrypted seed at rest (versioned KDF policy)
    biometric.ts    JS side of the Keystore plugin
    history.ts      transactions, net effect, confirmation counts
    liveUpdates.ts  scripthash subscriptions, debounce, backstop poll
    servers.ts      endpoint list, connect budgets, auto-candidates
    price.ts        RXD/USD with cache and fallback
    explorer.ts     txid → explorer URL (validated)
    openUrl.ts      JS side of the OpenUrl plugin
    reauth.ts       per-payment confirmation
    autoLock.ts     lock policy (pure, unit-tested)
  screens/
    Onboarding.tsx  create or restore, seed backup
    Unlock.tsx      passphrase or biometric, auto-prompt on resume
    Home.tsx        balance, activity, funds by address
    Receive.tsx     QR + address
    Send.tsx        compose → review → confirm → broadcast
    Settings.tsx    servers, auto-lock, biometrics, display, seed, wipe
  components/
    ActivityList.tsx  history rows, confirmation badges, explorer links
    BrandMark.tsx     the Radiant mark, themed
  shims/            browser replacements for Node internals
android/app/src/main/java/org/radiant/wallet/
  BiometricVaultPlugin.java   AndroidKeyStore + BiometricPrompt
  ScreenSecurityPlugin.java   WindowManager FLAG_SECURE
  OpenUrlPlugin.java          allowlisted https → system browser
  MainActivity.java           registers plugins, hardens the WebView
scripts/
  browser-path-check.ts  runtime proof: crypto, signing, history, price, live updates
  smoke-browser.mjs      loads the built bundle in headless Chrome
  build-icons.mjs        launcher icons from the vendored mark, size-asserted
  build-store-assets.mjs store graphics (see docs/PUBLISHING.md)
  release.mjs            build + sign + verify + copy to dist-android/
  probe-servers.mjs      liveness probe for every endpoint
  check-multisign.mjs    multi-address signing-order proof
  probe-tx-parse.mjs     pins down radiantjs input/output field semantics
  live-e2e.mjs           live ElectrumX read + offline tx build
```

### Why the shims exist

`radiantjs` was written for Node and reaches for Node internals. Bundling it for a
WebView is exactly where a wallet quietly breaks, so each replacement is deliberate:

| Shim | Why |
| --- | --- |
| `polyfills.ts` | Installs `Buffer`, `global` and a minimal `process` on `globalThis` **before** any library module evaluates. Without it the WebView threw `ReferenceError: Buffer is not defined` at startup and the app was a black screen. |
| `shims/crypto.ts` | `createHash` is deliberately **absent** so radiantjs picks its pure-JS hasher. `createHmac` **is** provided (over `js-sha512`) because `lib/mnemonic/pbkdf2.js` calls it unconditionally with no fallback — without it, *creating any wallet fails*. |
| `shims/assert.cjs` | Node's `assert` is externalized to an empty module, so `assert(…)` throws "not a function" during HD key building and **transaction serialisation**. Must be `.cjs` so `module.exports` is the callable. |
| `shims/ws.ts` | The SDK imports `ws` only as a Node fallback; the WebView always uses the global `WebSocket`. |
| `process.browser` define | `lib/crypto/random.js` branches on it to choose Web Crypto over `crypto.randomBytes`. Without it the CSPRNG path is dead. |

### The bug that only a real browser could catch

The first APK installed as a **black screen**: a bare `Buffer` reference that is
harmless in Node and fatal in a WebView. The whole Node-based suite passed while the
app was dead. Three things came out of it — `src/polyfills.ts` imported first in
`main.tsx`; a **startup watchdog** in `index.html` that renders the real error,
stack and WebView UA on screen instead of a silent black page; and
`npm run check:smoke`, which serves the built bundle to headless Chrome and asserts
it actually mounts. The smoke test is a CI gate and was verified to *fail* on the
broken bundle, and the APK's own packaged assets were tested the same way via
`SMOKE_DIST=<dir>`.

## Testing

```bash
npm run typecheck       # tsc --noEmit
npm run build           # bundle
npm run check:browser   # crypto, signing, history, price, live updates (Node graph)
npm run check:smoke     # load the built bundle in headless Chrome
npm run probe           # live liveness of every Electrum endpoint
```

`check:browser` exercises the app's real module graph and asserts a known BIP39
test-vector address, a freshly generated mnemonic, a signed transaction (sighash
`0x41`, correct pubkey, sane fee), the history engine's direction/confirmation/fee
arithmetic against synthetic transactions, the KDF migration path, the price
formatter and cache, and the live-update subscription lifecycle.

The important gate is `check:smoke` — it is the one that would have caught the black
screen, and it runs in CI on a Linux runner, not just locally.

All three run on every push via `.github/workflows/android.yml`, which then builds a
debug APK and uploads it as an artifact.

## Releasing

```powershell
npm version patch      # 1.0.10 → 1.0.11
npm run release        # → dist-android/radiant-wallet-1.0.11.apk
```

`npm run release` builds the web assets, syncs Capacitor, produces a *signed*
release APK, runs `apksigner` to verify it, and copies it to `dist-android/`. It
refuses to hand over an unsigned or broken artifact.

### Publishing the release

```powershell
$env:GITHUB_TOKEN = "<token with repo scope>"
npm run publish:release
```

This creates the `v<version>` tag and release, uploads the APK as an asset, and
prints the download URL. It is safe to re-run: an existing release is reused and an
already-attached asset of the same size is skipped, so a failed upload doesn't leave
a 422 behind.

The release body is generated from the exact bytes being uploaded — size and SHA-256
are computed from the file, never typed. To write proper notes instead, add
`docs/release-notes-<version>.md` and it is used verbatim.

Publishing straight from a release asset is deliberate: it is the only download route
that gives users a stable URL, a visible file size and a hash to check, without
needing to build anything.

`package.json` is the single source of truth for the version; Gradle reads it and
derives `versionCode` as `major*10000 + minor*100 + patch`, so it always increases
and Android never rejects the update. The in-app About card is injected from the
same field at build time, so it cannot drift.

### Producing a signed build

One-time setup, and the key must be yours:

```bash
keytool -genkeypair -v -keystore android/rxd-release.jks -storetype JKS \
  -alias rxd-release -keyalg RSA -keysize 4096 -validity 10000 \
  -dname "CN=Birnie, O=Radiant Wallet, C=CA"
```

Then `android/keystore.properties`:

```properties
storeFile=rxd-release.jks
storePassword=…
keyAlias=rxd-release
keyPassword=…
```

`storeFile` is resolved relative to `android/`, not the repo root. Both files are
gitignored. With no keystore present, `assembleRelease` yields an **unsigned** APK
rather than silently falling back to a debug key.

### If a release build misbehaves

Release builds are minified with WebView debugging off, so there is no console. Set
`webContentsDebuggingEnabled: true` in `capacitor.config.ts` **temporarily** and
remember `hardenWebView()` forces it off again — comment out that line too. Then
`npx cap run android` and read the error in `chrome://inspect`. Revert both before
shipping.

### Before a new release

- `npm run probe` — if the verified servers have died, fix `src/lib/servers.ts`.
  This is the only part that degrades silently.
- `npm outdated` — after any dependency bump, re-run `check:browser` and
  `check:smoke`.
- Install over the previous build and confirm `firstInstallTime` is unchanged, which
  proves the wallet survived:
  `adb shell dumpsys package org.radiant.wallet | Select-String firstInstallTime`

## Known issues and roadmap

| Item | Notes |
| --- | --- |
| Broadcast with real funds | Prove it with a small amount before trusting it |
| SPV / header verification | The largest remaining trust gap |
| QR **scanning** | Display works; camera scanning does not exist yet |
| Glyph tokens, WAVE names | Needs `radiantcore.org` endpoints, unreachable when last checked |
| Keystore key invalidation | Survived in code, but only provable on a device that re-enrols a fingerprint |
| Play Store | Deliberately shelved — financial apps need an organisation account. See [docs/PUBLISHING.md](docs/PUBLISHING.md) |

### Design

The UI mirrors [radiantblockchain.org](https://radiantblockchain.org), with tokens
lifted from their stylesheet rather than eyeballed: pure black `#000000` canvas,
brand cyan `#00A8E0`, Inter Variable bundled via `@fontsource-variable/inter` (so it
renders offline in the WebView), and 4–6 px radii. Both light and dark themes follow
`prefers-color-scheme`.

The mark is the official two-tone R (cyan `#30C0F0` + cream `#F0F0C0`) vendored at
`assets/brand/radiant-mark.png`. Because cream is invisible on white, the icon
generator emits a single-ink variant for light mode, and `npm run icons` measures the
ink bounding box of every output, failing if it falls outside Android's safe zone.

## Licence

**MIT** — see [LICENSE](LICENSE). Copyright (c) 2026 Birnie. Use, modify and
redistribute freely, including commercially, provided the copyright and permission
notices are retained.

Two carve-outs:

- **`assets/brand/radiant-mark.png` and icons generated from it are Apache-2.0**, not
  MIT — they come from the Radiant project. Keep their attribution.
- **Dependencies keep their own licences.** `@radiant-core/sdk`,
  `@radiant-core/radiantjs`, Capacitor and React are MIT; Inter is SIL OFL 1.1; the
  AndroidX libraries are Apache-2.0.

## Attribution

Signing, ref-safety and Glyph logic come from
[`@radiant-core/sdk`](https://github.com/Radiant-Core/radiant-sdk) and
`@radiant-core/radiantjs` (both MIT). The endpoint list is adapted from
[Photonic Wallet](https://github.com/RadiantBlockchain-Community/photonic-wallet).
This is an independent client, not affiliated with the Radiant Foundation.

Use at your own risk — this is unaudited software handling real money.

