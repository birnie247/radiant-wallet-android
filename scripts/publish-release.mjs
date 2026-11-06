#!/usr/bin/env node
/**
 * Publish the signed APK as a GitHub Release asset, so it can be downloaded and
 * installed directly without cloning the repo.
 *
 *   npm run release           # build + sign → dist-android/radiant-wallet-<v>.apk
 *   npm run publish:release   # create the release and upload that APK
 *
 * Needs a token with `repo` scope in GITHUB_TOKEN. The tag is `v<version>` from
 * package.json, and the asset name matches the local file so links stay stable.
 *
 * Release notes come from docs/release-notes-<version>.md when present,
 * otherwise a body is generated with the size and SHA-256 of the exact bytes
 * being uploaded — those numbers must never be typed by hand.
 */
import { readFileSync, statSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join, basename } from "node:path";

const API = "https://api.github.com";

const die = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};

const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
if (!token) die("GITHUB_TOKEN is not set (needs `repo` scope)");

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const tag = `v${version}`;
const apk = join("dist-android", `radiant-wallet-${version}.apk`);
if (!existsSync(apk)) die(`${apk} not found — run \`npm run release\` first`);

const repoSlug = (() => {
  const remote = execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" }).trim();
  const m = remote.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
  if (!m) die(`cannot parse a GitHub repo from origin: ${remote}`);
  return `${m[1]}/${m[2]}`;
})();

const bytes = readFileSync(apk);
const size = statSync(apk).size;
const sha256 = createHash("sha256").update(bytes).digest("hex");
const assetName = basename(apk);

console.log(`repo   ${repoSlug}`);
console.log(`tag    ${tag}`);
console.log(`asset  ${assetName}  ${size} bytes`);
console.log(`sha256 ${sha256}`);

async function api(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "rxd-wallet-release",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  return { res, text, json: text ? JSON.parse(text) : null };
}

function buildBody() {
  const notesFile = join("docs", `release-notes-${version}.md`);
  if (existsSync(notesFile)) {
    console.log(`notes  ${notesFile}`);
    return readFileSync(notesFile, "utf8");
  }
  return [
    `Signed APK for Radiant Wallet ${version}, ready to sideload.`,
    "",
    "## Install",
    "",
    "Download the APK below, tap it, and allow \"install unknown apps\" for whichever",
    "app opens it. Requires Android 8.0+ (minSdk 26).",
    "",
    "```bash",
    `adb install -r ${assetName}`,
    "```",
    "",
    "Updating over an existing install keeps your wallet, because the signing key is",
    "unchanged. A different key would force an uninstall, which erases the local vault.",
    "",
    "## Verify",
    "",
    "| | |",
    "| --- | --- |",
    `| File | \`${assetName}\` |`,
    `| Size | ${size.toLocaleString("en-US")} bytes |`,
    `| SHA-256 | \`${sha256}\` |`,
    "",
    "```bash",
    `sha256sum ${assetName}`,
    "```",
    "",
    "## Before you trust it",
    "",
    "This is unaudited software handling real money. Broadcast has never been",
    "exercised with real funds, and balances come from a single ElectrumX server with",
    "no SPV verification, so treat it as a semi-trusted view of the chain. The",
    "[README](https://github.com/" + repoSlug + "#readme) documents exactly what is and",
    "is not verified.",
  ].join("\n");
}

// Create the release, or reuse the existing one so re-running after a failed
// upload does not fail with a 422.
let release;
{
  const existing = await api(`/repos/${repoSlug}/releases/tags/${tag}`);
  if (existing.res.ok) {
    release = existing.json;
    console.log(`release exists (id ${release.id}) — reusing`);
  } else if (existing.res.status === 404) {
    const created = await api(`/repos/${repoSlug}/releases`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tag_name: tag,
        target_commitish: "main",
        name: `Radiant Wallet ${version}`,
        body: buildBody(),
        draft: false,
        prerelease: false,
      }),
    });
    if (!created.res.ok) die(`create failed ${created.res.status}: ${created.text.slice(0, 400)}`);
    release = created.json;
    console.log(`release created (id ${release.id})`);
  } else {
    die(`lookup failed ${existing.res.status}: ${existing.text.slice(0, 400)}`);
  }
}

// Skip the upload if this exact asset is already attached.
const already = (release.assets ?? []).find((a) => a.name === assetName);
if (already && already.size === size) {
  console.log(`asset already attached (${already.size} bytes) — nothing to do`);
} else {
  const up = await fetch(
    `https://uploads.github.com/repos/${repoSlug}/releases/${release.id}/assets?name=${encodeURIComponent(assetName)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "rxd-wallet-release",
        "Content-Type": "application/vnd.android.package-archive",
        "Content-Length": String(bytes.length),
      },
      body: bytes,
    },
  );
  const text = await up.text();
  if (!up.ok) die(`upload failed ${up.status}: ${text.slice(0, 400)}`);
  const asset = JSON.parse(text);
  if (asset.size !== size) die(`uploaded size ${asset.size} != local ${size}`);
  console.log(`asset uploaded (id ${asset.id}, ${asset.size} bytes)`);
}

console.log(`\n✓ ${release.html_url}`);
console.log(`  download: https://github.com/${repoSlug}/releases/download/${tag}/${assetName}`);
