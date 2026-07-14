import { build } from "esbuild";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = resolve(root, "packages/pi-tin");
const outDir = resolve(sourceDir, "dist");

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

await build({
  entryPoints: [resolve(sourceDir, "index.ts")],
  outfile: resolve(outDir, "index.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  sourcemap: true,
  legalComments: "linked",
  external: ["@earendil-works/pi-coding-agent"],
});

const manifest = {
  name: "@pi-tin/pi-extension",
  version: "0.1.0",
  type: "module",
  private: true,
  description: "Built Pi Tin host extension",
  license: "MIT",
  keywords: ["pi-package"],
  pi: { extensions: ["./index.mjs"] },
};

await writeFile(resolve(outDir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await cp(resolve(root, "LICENSE"), resolve(outDir, "LICENSE"));
console.log(`Built self-contained Pi extension: ${outDir}`);
