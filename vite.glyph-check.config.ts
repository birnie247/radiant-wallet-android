import { defineConfig } from "vite";
import base from "./vite.config.ts";

/**
 * Config for scripts/glyph-helper-check.ts: offline unit checks for the
 * pure Glyph helpers in src/lib/glyphs.ts (parseServerRef, refGetArg,
 * extractGlyphPayload, payloadToMetadata, tokenFreeFunding, fee estimation).
 *
 * Same shape as vite.test.config.ts: inherits every alias/define from
 * vite.config.ts and BUNDLES the Radiant packages so the exact browser-path
 * dependencies power the checked-in fixtures rather than some parallel copy.
 */
export default defineConfig({
  ...base,
  ssr: {
    noExternal: true,
    target: "node",
  },
  build: {
    ssr: "scripts/glyph-helper-check.ts",
    outDir: "dist-test-glyph",
    emptyOutDir: true,
    target: "es2022",
    minify: false,
  },
});
