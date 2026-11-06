# Publishing to Google Play

> Moved out of the main README: this wallet is distributed by sideload, not through
> Play (financial apps need an organisation developer account). Kept because the
> signing and store-asset work is reusable.

Everything the repo can do for you is done; the rest is account and policy work
that only you can complete.

### What is already prepared

| Item | Where | Status |
| --- | --- | --- |
| Uploadable bundle | `./gradlew bundleRelease` → `android/app/build/outputs/bundle/release/app-release.aab` | builds locally (**1.99 MB**) |
| App icon 512×512 | `play/store/icon-512.png` | generated (`npm run store:assets`) |
| Feature graphic 1024×500 | `play/store/feature-graphic-1024x500.png` | generated |
| Privacy policy | `docs/privacy-policy.html` | written — needs hosting |
| targetSdk 36 / minSdk 26 | `android/variables.gradle` | meets Play's currency rule |
| Non-debuggable, R8 shrinking, v2+v3 signing | `android/app/build.gradle` | verified with `apksigner` |

### 1. Create an upload key (do this yourself)

Play uses **Play App Signing**: the key you generate here is the *upload* key;
Google holds the actual app-signing key. Never let anyone else generate it, and
back it up offline.

```powershell
keytool -genkeypair -v -keystore android/rxd-release.jks -storetype PKCS12 `
  -alias rxd -keyalg RSA -keysize 4096 -validity 10000 `
  -dname "CN=Birnie, O=Radiant Wallet, C=CA"
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

GitHub → **Settings → Pages → Source: Deploy from a branch → `main` / `/docs`**

Your policy then lives at:

```
https://birnie247.github.io/radiant-wallet-android/privacy-policy.html
```

The page is accurate as written: the app collects nothing, has no backend and no
analytics. If you later add analytics or a phone-home price feed, update it — a
policy that contradicts what the app does is a common suspension reason.

### 4. Play Console setup

Create the app, then complete **App content** (all of it is mandatory):

- **Privacy policy** → the URL above.
- **Ads** → no.
- **App access** → no accounts or logins. Give reviewers a note:
  *"No account needed. Tap ‘Create a new wallet’, write down the 12 words, choose
  any 12+ character passphrase. No funds are required to review the app."*
- **Content rating** → complete the IARC questionnaire.
- **Target audience** → 18+.
- **Data safety** → **no data collected or shared.** Don't tick "encrypted in
  transit": that question applies to data you collect, and you collect none.
- **Financial features** → declare **crypto wallet / self-custody**. This is the
  declaration that matters for a crypto app. Read Google's current Financial
  Services policy yourself — it changes, and it varies by country.

### 5. Store listing

| Field | Limit | Suggested |
| --- | --- | --- |
| App name | 30 chars | `Radiant Wallet` |
| Short description | 80 chars | `Non-custodial wallet for Radiant (RXD). Your keys never leave your device.` |
| Full description | 4000 chars | Self-custody, Electrum servers, no accounts, no tracking |
| App icon | 512×512 | `play/store/icon-512.png` |
| Feature graphic | 1024×500 | `play/store/feature-graphic-1024x500.png` |
| Phone screenshots | 2–8 | capture from a device (below) |
| Contact email | — | `birnie@915mhz.ca` |
| Category | — | Finance |

Screenshots are far better captured from the real app than mocked up. With the
phone connected over USB:

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
- **The Electrum trust gap is real.** Balances and confirmations come from a
  single server with no SPV verification. Consider saying so in the store
  description — users of a wallet deserve to know.
- **Play does remove crypto wallets** that fail the financial declaration or
  mislead users. Keep the listing literal about what the app does.
