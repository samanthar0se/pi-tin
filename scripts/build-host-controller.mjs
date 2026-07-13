import { build } from "esbuild";
import { mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, "packages/host/dist");
await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
await build({
  entryPoints: [resolve(root, "packages/host/src/index.ts")],
  outfile: resolve(outDir, "index.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  sourcemap: true,
  external: ["@earendil-works/pi-coding-agent", "@earendil-works/pi-coding-agent/rpc-entry", "ws"],
});
console.log(`Built Pi Remote host controller: ${outDir}`);
