#!/usr/bin/env node
/**
 * Build the Google Play upload artifact.
 *
 *   npm run bundle            # uses package.json version
 *   npm run bundle -- --skip-web   # reuse an existing dist/ (CI, repeated runs)
 *
 * Steps: web build → cap sync → `bundleRelease` → copy the AAB to
 * dist-android/lumen-rxd-wallet-<version>.aab with the version in the name.
 *
 * Play wants an **AAB**, not an APK: Google re-signs it with the app-signing key
 * it holds (Play App Signing), and the key in android/keystore.properties is only
 * the *upload* key. The AAB is still signed locally, because Play rejects an
 * unsigned upload.
 *
 * Requirements: a keystore configured in android/keystore.properties (see
 * docs/PUBLISHING.md). Without one Gradle emits an unsigned bundle.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
const version = pkg.version;
const [maj, min, pat] = version.split(".").map((n) => parseInt(n, 10));
const versionCode = maj * 10000 + min * 100 + pat;

const JAVA_HOME = process.env.JAVA_HOME ?? "C:/Android/jdk21";
const ANDROID_HOME = process.env.ANDROID_HOME ?? "C:/Android/Sdk";

const fail = (msg) => {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
};

const javaBin = path.join(
  JAVA_HOME,
  "bin",
  process.platform === "win32" ? "java.exe" : "java",
);
if (!existsSync(javaBin)) {
  fail(`JDK not found at ${JAVA_HOME}. Set JAVA_HOME to a JDK 21 install.`);
}
if (!existsSync(ANDROID_HOME)) fail(`Android SDK not found at ${ANDROID_HOME}.`);
if (!existsSync(path.join(ROOT, "android", "keystore.properties"))) {
  fail(
    "android/keystore.properties is missing, so the bundle would be unsigned.\n" +
      "  Play rejects an unsigned AAB — see docs/PUBLISHING.md.",
  );
}

const env = { ...process.env, JAVA_HOME, ANDROID_HOME };

function run(label, cmd, args, cwd = ROOT) {
  console.log(`\n▸ ${label}`);
  try {
    execFileSync(cmd, args, { cwd, env, stdio: "inherit" });
  } catch (e) {
    console.error(`  ${e.message}`);
    fail(`${label} failed`);
  }
}

console.log(`Lumen RXD Wallet ${version}  (versionCode ${versionCode})`);
const gradle = readFileSync(path.join(ROOT, "android", "app", "build.gradle"), "utf8");
const appId = (gradle.match(/applicationId\s+"([^"]+)"/) ?? [, "?"])[1];
console.log(`package ${appId}  ← this must match the app in Play Console`);

if (!process.argv.includes("--skip-web")) {
  run("building web assets", process.execPath, ["node_modules/vite/bin/vite.js", "build"]);
  run("syncing Capacitor", process.execPath, [
    "node_modules/@capacitor/cli/bin/capacitor",
    "sync",
    "android",
  ]);
}

// Run Gradle through its wrapper JAR with the JDK's java binary: no shell, so no
// quoting hazard on a path with spaces.
const wrapperJar = path.join(ROOT, "android", "gradle", "wrapper", "gradle-wrapper.jar");
if (!existsSync(wrapperJar)) fail(`Gradle wrapper jar not found at ${wrapperJar}`);

run(
  "assembling signed release bundle",
  javaBin,
  [
    "-classpath",
    wrapperJar,
    "org.gradle.wrapper.GradleWrapperMain",
    "bundleRelease",
  ],
  path.join(ROOT, "android"),
);

const built = path.join(ROOT, "android/app/build/outputs/bundle/release/app-release.aab");
if (!existsSync(built)) fail("no app-release.aab was produced");

const outDir = path.join(ROOT, "dist-android");
mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, `lumen-rxd-wallet-${version}.aab`);
copyFileSync(built, out);

const mb = (statSync(out).size / (1024 * 1024)).toFixed(2);
console.log(`\n✓ ${path.relative(ROOT, out)}  (${mb} MB, versionCode ${versionCode})`);
console.log("\nUpload this file to Play Console → Test and release → Internal testing.");
console.log("Play re-signs it; the local key is only the upload key.");
