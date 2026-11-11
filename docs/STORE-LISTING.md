# Play Store listing — copy to paste

Everything in this file goes straight into Play Console. Character limits are
Play's; the counts below are of the text as written here.

## App name (30 max)

```
Lumen RXD Wallet
```
16 characters.

## Short description (80 max)

```
Self-custody RXD wallet. Keys stay on your phone — no accounts, no tracking.
```
76 characters.

## Full description (4000 max)

```
Lumen RXD Wallet is a self-custody wallet for Radiant (RXD). Your recovery phrase is created on the device, encrypted with your passphrase, and used to sign transactions locally. No server ever sees a private key.

WHAT MAKES IT DIFFERENT

• Real SPV verification. Block headers are checked from a pinned checkpoint, and the transactions shown in your history are proved to be inside those blocks with merkle proofs — not just taken on trust from a server.

• Ref-safe sending. Radiant UTXOs can carry Glyph tokens in their output scripts. Spending one as ordinary fee funding destroys the token; this wallet screens every funding candidate so that cannot happen by accident.

• Your servers, your choice. A built-in list of ElectrumX endpoints, plus the ability to add, test and remove your own. The wallet refuses to let you remove the last one, and a failed server falls through to the next automatically.

• Restores old seeds too. Wallets created before Radiant's coin type existed derived at m/44'/0'. Tick "This is a v1 seed" when restoring and the same 12 words reach the same addresses.

WHAT YOU CAN DO

• Create a wallet (BIP39, 12 words) or restore 12–24 words
• Receive with a QR code; send with a review step, re-confirmed by passphrase or biometric
• See balance, UTXOs and history with confirmation counts; tap a transaction to open it on the block explorer
• Optional RXD/USD value (CoinGecko, cached, switchable off)
• Auto-lock when the app leaves the foreground, screenshots blocked by default, biometric unlock backed by the Android Keystore

PRIVACY — THE HONEST VERSION

There are no accounts, no analytics, no advertising and no backend of this app's own. But a lightweight wallet must ask a server about the blockchain: balances and history are read from ElectrumX servers over encrypted WebSocket connections, and those servers necessarily see your IP address and the addresses you query.

This app ships with a default endpoint, rxdexplorer.com, run by the developer. So by default, the developer's server sees your IP address and the addresses your wallet queries. It never sees your recovery phrase, your keys or your passphrase — those never leave the device. Prefer not to use it? Settings → ElectrumX server lets you switch to another server or add your own, and the choice is remembered on the device.

WHAT IS NOT PROVEN YET

This is unaudited software handling real money. One real mainnet send has been broadcast successfully with this build line; that is evidence, not a track record. SPV covers headers, chain linkage and merkle inclusion, but not the per-block difficulty rule. Balances still come from a single server, which cannot steal but can misreport state — two independent operators' chain tips are cross-checked to catch gross disagreement.

Not implemented yet: QR scanning, Glyph tokens, WAVE names, background push notifications. Mainnet only.

Requires Android 9 or later. Open source (MIT): https://github.com/birnie247/radiant-wallet-android
```
Roughly 2,750 characters — comfortably inside 4,000.

## What's new (500 max)

```
New app identity for the Play release, plus three things worth updating for.

• Restore a v1 seed: a checkbox on the restore screen derives the old m/44'/0' path, for phrases from wallets made before Radiant's coin type existed.
• Your own ElectrumX servers: add, test with a real handshake, remove; built-ins are hidden rather than deleted, and the last server cannot be removed.
• rxdexplorer.com is the new default endpoint, and the tip cross-check now compares against two distinct operators.
• Android 9+ only (minSdk 28).
```

## Data safety answers

| Question | Answer |
| --- | --- |
| Does your app collect or share user data? | **Yes** — see the next rows. Answer `No` only if the default server keeps no logs at all (see PUBLISHING.md). |
| What data | **IP address** — collected, not shared. **App activity** (blockchain addresses queried) — collected, not shared. No location, no contacts, no device IDs, no financial info. |
| Purpose | App functionality only. |
| Shared with third parties? | No. The ElectrumX peers are services the user picks; the default endpoint is the developer's own. |
| Processed ephemerally? | Yes **only** if the server keeps no persistent logs. Otherwise say no and pick a retention period. |
| Encrypted in transit? | Yes — every connection is wss:// with a verified TLS certificate. |
| Can users request deletion? | No accounts exist and nothing is stored per user; state that in the free-text box. |

## App content

- **Financial features** → crypto wallet / self-custody.
- **Ads** → no.
- **App access** → all functionality available without login. Reviewer note:
  *"No account needed. Tap 'Create a new wallet', write down the 12 words, choose any
  12+ character passphrase. No funds are required to review the app. Settings →
  ElectrumX server shows the server list."*
- **Content rating** → IARC questionnaire; expect Everyone / PEGI 3 (no violence, no
  user-generated content, no ads).
- **Target audience** → 18+ (financial app).
- **News app** → no.

## Graphics and screenshots

| Asset | File | Status |
| --- | --- | --- |
| App icon 512×512 | `play/store/icon-512.png` | ✔ regenerated |
| Feature graphic 1024×500 | `play/store/feature-graphic-1024x500.png` | ✔ regenerated with the Lumen name |
| Phone screenshots (2–8) | capture from a device | needed |

Capture with **Settings → Allow screenshots (QR sharing)** on, otherwise
`FLAG_SECURE` gives you black rectangles. Suggested set and captions:

1. Welcome — *"Self-custody RXD. Your keys never leave the phone."*
2. Seed backup — *"12 words, written down once, encrypted on device."*
3. Home — *"Balance, UTXOs, live updates."*
4. Receive — *"QR and address, ready to share."*
5. Send review — *"Every payment confirmed twice: review, then biometric or passphrase."*
6. Settings → ElectrumX server — *"Choose, add or remove your own server."*

## Contact and category

- **Contact email:** `birnie@915mhz.ca`
- **Category:** Finance · **Tags:** crypto wallet, self-custody
- **Privacy policy URL:** after hosting `docs/privacy-policy.html` (GitHub Pages or
  `rxdexplorer.com`), e.g.
  `https://birnie247.github.io/radiant-wallet-android/privacy-policy.html`
- **Website:** https://github.com/birnie247/radiant-wallet-android

## Channel policy (for the README, not Play)

Releases on GitHub are the primary channel until Play accepts the listing; after
that Play is primary and the APK releases stop. Play re-signs the bundle with a
Google-held key, so a Play install and a sideloaded APK are different signers of
the same package — a user cannot move between them without uninstalling, which
erases the local vault.
