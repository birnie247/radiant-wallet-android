**Lumen RXD Wallet 1.4.0** — Glyph tokens arrive. The wallet now **displays** the
Glyph tokens it owns and **sends** them, whole or in part, to another address.
The send path was exercised against mainnet through `wss://rxdexplorer.com`
before this release: a real partial FT send with change, a real NFT transfer to
an external address, and a sub-dust send that the wallet correctly refused.

> **Mint is not in the app yet.** Minting an FT/NFT is implemented in the SDK and
> was proven on mainnet through the test harness (`scripts/live-glyph-send.ts
> --mint` / `--mint-ft`), but 1.4.0 ships **no in-app mint screen**. An in-app
> mint UI is the next step. This release is view + send.

## What 1.4.0 adds

- **Token discovery.** Glyph outputs are indexed under the *zeroed-ref*
  scripthash of each address's FT/NFT script, not its plain P2PKH hash. The scan
  queries those variants for every used address, rebuilds each token script
  locally from `(address, ref)`, and only accepts a row whose rebuilt script
  hashes back to the query — a server cannot slip a foreign script past it.
- **Balances stay honest.** RXD riding inside token outputs is reported
  separately as *locked* and is never counted as spendable. Home shows
  "X RXD in tokens — not spendable as fees".
- **Metadata.** The reveal transaction's `gly` envelope is decoded (CBOR) for
  name, description, attributes and a raster icon. Icons are limited to
  png/jpeg/gif/webp and size-capped; SVG/markup is dropped at the boundary, so
  nothing script-bearing reaches the WebView. Bare mints (no envelope) fall back
  to a ref-labelled placeholder. Immutable metadata is cached locally.
- **Three new screens.** *Tokens* (a ref-identified list), *Token detail*
  (icon, protocol badges, attributes, the artifact id, locked RXD, its UTXOs)
  and *Send token* (destination, amount for an FT, fee tier, and a review sheet).
- **Send-time re-authentication.** Moving a token asks for a biometric or the
  passphrase, exactly like an RXD payment — an unlocked session alone is not
  enough.

## The two guards that matter

- **Burn guard.** A UTXO carrying a Glyph ref is never selected as ordinary fee
  funding. Detection is shape-based (it walks the opcode stream and skips push
  payloads), so a P2PKH whose hash160 happens to contain `0xd0–0xd8` bytes is
  *not* mis-flagged, while a real token script always is. The funding path
  screens candidates twice — indexer refs and a local opcode scan.
- **Dust guard.** A Glyph FT output's value *is* its amount, so a send below the
  dust limit (1000 base units) would be unspendable. The wallet rejects it
  loudly instead of broadcasting an unminable transaction. A partial FT send
  emits an FT change output so the covenant's sum is conserved exactly.

One consequence worth knowing: a token can only be sent onward from an address
that **also holds RXD** for the fee, because the SDK signs all inputs with one
key. The send screen says so when an address has no fee budget.

## Live evidence

Whole and partial sends and the dust rejection were run against mainnet through
the app's own send helpers during development. A partial FT send produced three
outputs — the amount to the recipient, FT change back to the sender, and RXD
change — with the input sum conserved exactly. An NFT send to an external address
was confirmed by inspecting the accepted transaction and the destination's UTXO
index. Minting (FT and NFT) was proven separately via the SDK harness, not the
app UI. This is real evidence from real sends, but a handful of sends is not a
track record: start small.

## Install

Download `lumen-rxd-wallet-1.4.0.apk` below and tap it, or:

```bash
adb install -r lumen-rxd-wallet-1.4.0.apk
```

Requires **Android 9+** (minSdk 28). 1.4.0 is signed by the same key as 1.3.x, so
it installs straight over it and your wallet survives.

## Verify what you downloaded

| | |
| --- | --- |
| File | `lumen-rxd-wallet-1.4.0.apk` |
| Size | 2,191,931 bytes (2.09 MB) |
| SHA-256 | `b4db95df7c51bbebc922ffc8da6876f90c4b6ace119628b3887a560c043e4b3f` |
| versionName / Code | 1.4.0 / 10400 |
| Package | `com.rxdexplorer.lumen` |
| Signed by | `CN=Birnie, O=Lumen RXD Wallet, C=CA` |
| Cert SHA-256 | `84f7a01f0e4987f28354767e2c3dc53284fec1a033864bc39b982b28f1075e56` (same as 1.3.0/1.3.1) |
| Scheme | APK Signature **v3** |

```bash
sha256sum lumen-rxd-wallet-1.4.0.apk
apksigner verify --print-certs lumen-rxd-wallet-1.4.0.apk
```

## Play Store

`lumen-rxd-wallet-1.4.0.aab` is attached for Play Console upload:

| | |
| --- | --- |
| File | `lumen-rxd-wallet-1.4.0.aab` |
| Size | 2,131,154 bytes (2.03 MB) |
| SHA-256 | `c19a8acb7813dcb42604d26b6574f1ee09192d52d6a3a84ad8cfb90c5dd6af8a` |
| versionCode | 10400 |
| Upload key | `84f7a01f…f1075e56` (Play re-signs with its app-signing key) |

## Privacy — unchanged

No backend, no analytics, no accounts. The default ElectrumX endpoint,
`wss://rxdexplorer.com`, is run by the developer, so by default it sees your IP
address and the addresses your wallet queries — including the zeroed-ref token
scripthashes it now subscribes to. It never sees your phrase, keys or passphrase.
Settings → ElectrumX server switches it or adds your own.

## Honest status

Unaudited software handling real money. Balances still come from a single server,
which cannot steal but can misreport state. SPV covers headers, checkpointed
linkage and merkle inclusion, not the per-block difficulty rule. Glyph send is
live-tested but young — widen that coverage over time, and start small. Not
implemented: **in-app Glyph mint** (SDK/harness only for now), QR scanning, WAVE
names, background push notifications. Mainnet only.

## Source

Built from tag [`v1.4.0`](https://github.com/birnie247/radiant-wallet-android/tree/v1.4.0).
MIT licensed, with the Radiant artwork under Apache-2.0.
