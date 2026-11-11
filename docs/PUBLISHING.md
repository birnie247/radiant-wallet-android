# Publishing to Google Play

> Moved out of the main README: this wallet is distributed by sideload, not through
> Play (financial apps need an organisation developer account). Kept because the
> signing and store-asset work is reusable.

Everything the repo can do for you is done; the rest is account and policy work
that only you can complete.

**Identity, and it is permanent:** package `com.rxdexplorer.lumen`. Play treats
the package as the app's identity forever — it cannot be changed after the first
upload, and a different one is a different app. It is reverse-DNS on
`rxdexplorer.com`, which the maintainer controls, rather than on `radiant*` names
this project has no claim to. Changing it now is a one-line edit plus a Java
package move; changing it after publishing means starting the listing again.

### What is already prepared

| Item | Where | Status |
| --- | --- | --- |
| Uploadable bundle | `./gradlew bundleRelease` → `android/app/build/outputs/bundle/release/app-release.aab` | builds locally (~1.7 MB) |
| App icon 512×512 | `play/store/icon-512.png` | generated (`npm run store:assets`) |
| Feature graphic 1024×500 | `play/store/feature-graphic-1024x500.png` | generated |
| Privacy policy | `docs/privacy-policy.html` | written — needs hosting |
| targetSdk 36 / minSdk 28 | `android/variables.gradle` | meets Play's currency rule |
| Signed AAB from one command | `npm run bundle` → `dist-android/lumen-rxd-wallet-<v>.aab` | works |
| Non-debuggable, R8 shrinking, v2+v3 signing | `android/app/build.gradle` | verified with `apksigner` |

### 1. Create an upload key (do this yourself)

Play uses **Play App Signing**: the key you generate here is the *upload* key;
Google holds the actual app-signing key. Never let anyone else generate it, and
back it up offline.

This project already has one at `android/rxd-release.jks` (JKS, alias `rxd`,
4096-bit RSA, SHA-256 `226f0d84…725a7d`). It is the key that signed 1.0.13, 1.1.0
and 1.1.1, so reuse it rather than making another — its subject still reads
`O=Radiant Wallet` because that is what the shipped certificate says, and a
certificate's subject cannot be changed without changing the key. For a *new* key,
the equivalent command is:

```powershell
keytool -genkeypair -v -keystore android/rxd-release.jks -storetype JKS `
  -alias rxd -keyalg RSA -keysize 4096 -validity 10000 `
  -dname "CN=Birnie, O=Lumen RXD Wallet, C=CA"
```

Then create `android/keystore.properties` (gitignored). `storeFile` is resolved
**relative to `android/`**, so do not add `../`:

```properties
storeFile=rxd-release.jks
storePassword=…
keyAlias=rxd
keyPassword=…
```

If you lose the upload key you can request a reset in Play Console; the app
signing key stays safe with Google. Keep an offline copy anyway.

### 2. Build the bundle

```powershell
cd android
.\gradlew.bat bundleRelease
```

Play requires an **AAB** for new apps — not an APK. Bump `versionCode` in
`android/app/build.gradle` before **every** upload; it must always increase.

### 3. Host the privacy policy

Play will not accept the listing without a public URL.

Two files to publish, or one if you use the bundled copy:

| File | Note |
| --- | --- |
| `docs/privacy-policy.html` | the source page; it references `docs/radiant-mark.png` |
| `docs/radiant-mark.png` | the logo that page loads — post both, or the header image 404s |
| `docs/privacy-policy-standalone.html` | the same page with the logo inlined as a data URI — **one file, nothing else needed** |

Hosting on the domain you already run is the least work and looks best in the
listing: drop the standalone file on the web host and point Play at it, e.g.
`https://rxdexplorer.com/lumen/privacy-policy.html`. No DNS change is required for
a path on an existing hostname.

If you would rather use GitHub Pages, note that **Pages is not enabled on this
repository yet**:

GitHub → **Settings → Pages → Source: Deploy from a branch → `main` / `/docs`**

Your policy then lives at:

```
https://birnie247.github.io/radiant-wallet-android/privacy-policy.html
```

A `lumen.rxdexplorer.com` subdomain would need one DNS record (CNAME to
`birnie247.github.io` for Pages, or A/AAAA to your own host).

The page is accurate as written **as of 1.1.1**: no backend, no analytics, and one
developer-run default ElectrumX endpoint (`rxdexplorer.com`) which sees the user's IP
and the addresses the wallet queries. That last sentence matters for the Data safety
form below — a policy that contradicts what the app does is a common suspension
reason, and so is a Data safety section that contradicts the policy.

### 4. Play Console setup

Create the app, then complete **App content** (all of it is mandatory):

- **Privacy policy** → the URL above.
- **Ads** → no.
- **App access** → no accounts or logins. Give reviewers a note:
  *"No account needed. Tap ‘Create a new wallet’, write down the 12 words, choose
  any 12+ character passphrase. No funds are required to review the app."*
- **Content rating** → complete the IARC questionnaire.
- **Target audience** → 18+.
- **Data safety** → decide this honestly, because the answer changed in 1.1.0. The
  app has no backend of its own, no analytics and no identifiers, *but* it ships
  with a default ElectrumX endpoint run by the developer, and that server sees the
  user's IP and the address cluster. Two defensible answers:
  - **"No data collected"** — only if the server keeps no logs (turn ElectrumX
    session logging off / keep retention at zero). Then nothing is *retained*.
  - **Declare it** — IP address + "app activity" (addresses queried), not shared
    with third parties, ephemeral. This is the safer answer if logs are kept.

  Do not tick "encrypted in transit" thinking it describes wss:// — that question
  only applies to data you collect.
- **Financial features** → declare **crypto wallet / self-custody**. This is the
  declaration that matters for a crypto app. Read Google's current Financial
  Services policy yourself — it changes, and it varies by country.

### 4b. The signature split (decide before you upload)

Play uses **Play App Signing**: the AAB you upload is signed with *your* upload key,
and Google re-signs the delivered APK with an app-signing key it holds. Google's
certificate is therefore **different** from the one on the GitHub APK, and Android
refuses to install two builds of one package with different signers.

Consequences, all of which need to be in the store listing or the notes:

- A user on the GitHub APK cannot "update" to the Play build (or vice versa) without
  uninstalling — which erases the local vault.
- Keep the two channels separate and say so, or stop shipping the self-signed APK
  once Play is the primary channel.
- `android/rxd-release.jks` becomes the *upload* key. Back it up: losing it is
  recoverable (upload-key reset) but slow, and it is the key that authenticates you
  to Play.

### 5. Store listing

All of the copy — name, short and full description, "what's new", the Data safety
answers, the reviewer note and the screenshot list — lives in
[`STORE-LISTING.md`](./STORE-LISTING.md), written to be pasted straight into the
Console. It states the consequence of the default endpoint in the same words as the
privacy policy: the developer's server sees the user's IP and the addresses queried.

`npm run bundle` produces the upload artifact at
`dist-android/lumen-rxd-wallet-<version>.aab`; it prints the package name and
versionCode so you can check them against the Console entry before uploading.

Screenshots are far better captured from the real app than mocked up. The app raises
`FLAG_SECURE` app-wide, so a plain `screencap` returns a black rectangle — turn that
off first in **Settings → Allow screenshots (QR sharing)**, take the shots, then turn
it back on. With the phone connected over USB:

```powershell
C:\Android\Sdk\platform-tools\adb.exe exec-out screencap -p > shot-1.png
```

Take at least: onboarding, home/balance, receive (QR), send review. Play wants
16:9 or 9:16, minimum 320 px, maximum 3840 px on the long edge.

### 6. Roll out

**Internal testing** first — instant, no review, and it validates the AAB and the
signing config. Then **closed testing** (a few testers, triggers a real review),
then **production**. A first review for a crypto app commonly takes days, and
reviewers may come back with questions about the financial declaration — answer
in the Console rather than re-uploading.

### Honest caveats before you ship

- **This is unaudited software handling real money.** Publishing does not make it
  safe; the [Security model](../README.md#security) section lists exactly what is and
  isn't verified.
- **The Electrum trust gap is real.** Balances and confirmations come from a single
  ElectrumX server. SPV covers headers, checkpointed linkage and merkle inclusion, but
  not the per-block difficulty rule, and a lying server can still misreport history.
  Say so in the store description — users of a wallet deserve to know.
- **You are the default server.** `rxdexplorer.com` is yours, so the listing's privacy
  claims and the box's logging have to agree. See Data safety above.
- **Play does remove crypto wallets** that fail the financial declaration or
  mislead users. Keep the listing literal about what the app does.
