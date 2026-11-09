**Lumen RXD Wallet 1.1.1** — a one-fix release. Self-custody wallet for
[Radiant](https://radiantblockchain.org) (RXD) on Android; the recovery phrase is
generated, encrypted and used to sign entirely on the device.

Everything else is unchanged from
[1.1.0](https://github.com/birnie247/radiant-wallet-android/releases/tag/v1.1.0) —
same UI, same rename, same v1-seed restore, same default server. If you are on 1.1.0,
this is optional but worth taking.

## Upgrading

| From | What to do |
| --- | --- |
| **1.1.0** or **1.0.13** | `adb install -r`, or tap the APK. Same signing key, so your wallet survives. |
| **1.0.12 or older** | Signed with a retired key: uninstall first (erases the local vault), then restore from your recovery phrase. |

## Install

Download `lumen-rxd-wallet-1.1.1.apk` below and tap it (allow "install unknown apps"
for whichever app opens it), or:

```bash
adb install -r lumen-rxd-wallet-1.1.1.apk
```

Requires **Android 8.0+** (minSdk 26).

## Verify what you downloaded

| | |
| --- | --- |
| File | `lumen-rxd-wallet-1.1.1.apk` |
| Size | 1,747,353 bytes (1.67 MB) |
| SHA-256 | `e37ea147617adbb0849edcef0b1be99d0976f7ffd3e546c2486623f7b54f1f35` |
| versionName / Code | 1.1.1 / 10101 |
| Signed by | `CN=Birnie, O=Radiant Wallet, C=CA` |
| Cert SHA-256 | `226f0d84348ee46a80d5bb919fa3564e00222785071565584028d6206d725a7d` |
| Scheme | APK Signature v2 + v3, not debuggable |

```bash
sha256sum lumen-rxd-wallet-1.1.1.apk
apksigner verify --print-certs lumen-rxd-wallet-1.1.1.apk
```

## The fix: quorum needs two *operators*, not two hosts

The wallet cross-checks the connected server's chain tip against a peer run by a
**different operator** — that is the cheap way to notice a server that is lying about,
or badly behind, the chain. The selection step was wrong:

- `independentServers()` returns every endpoint belonging to another operator, and the
  check took its first two entries.
- With `rxdexplorer.com` as the default server (1.1.0), those first two were **both**
  `radiant4people.com` hosts. So when the first peer was unreachable, the second "second
  opinion" was the same administrator answering again — one opinion, retried.

`crossCheckCandidates()` now dedupes by operator before picking, so the peer really is a
second opinion:

```
primary: rxdexplorer.com        →  peers: radiant4people.com + radiantcore.org
primary: radiantcore.org        →  peers: rxdexplorer.com + radiant4people.com   (one of the two
                                    radiant4people hosts, not both)
```

Nothing visible changes: no UI, no new traffic, still at most two peers with a ~5 s
timeout each, and still no warning unless the tips actually disagree by more than two
blocks. It only changes *which* peer is asked.

## Honest status

Unchanged from 1.1.0, briefly: unaudited software handling real money; one real mainnet
send has succeeded; SPV covers headers, checkpointed linkage and merkle proofs but not the
per-block difficulty rule; balances still come from a single ElectrumX server (it cannot
steal — it never sees a key — but it can lie about state); the default endpoint is run by
this wallet's maintainer, and the tip cross-check is what keeps it honest against two
outside operators. The [1.1.0 notes](https://github.com/birnie247/radiant-wallet-android/releases/tag/v1.1.0)
and the [README](https://github.com/birnie247/radiant-wallet-android#readme) have the
detail.

## Source

Built from commit
[`9444186`](https://github.com/birnie247/radiant-wallet-android/tree/9444186) (the fix
itself). MIT licensed, with the Radiant artwork under Apache-2.0.
