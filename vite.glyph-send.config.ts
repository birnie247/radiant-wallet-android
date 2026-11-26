import { defineConfig } from "vite";
import base from "./vite.config.ts";

/**
 * Config for scripts/live-glyph-send.ts: the live Glyph send harness.
 * Bundled (not raw node) so it can import src/lib/glyphs.ts and exercise the
 * wallet's REAL guarded send helpers against rxdexplorer.com.
 *
 * Default behaviour is DRY-RUN; broadcasting needs --broadcast AND
 * RXD_SEND_CONFIRM=SEND. See the script header.
 */
export default defineConfig({
  ...base,
  ssr: {
    noExternal: true,
    target: "node",
  },
  build: {
    ssr: "scripts/live-glyph-send.ts",
    outDir: "dist-test-glyph-send",
    emptyOutDir: true,
    target: "es2022",
    minify: false,
  },
});
