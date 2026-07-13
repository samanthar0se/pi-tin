#!/usr/bin/env node
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));
const skipTests = args.has("--skip-tests");
const skipPlannotator = args.has("--skip-plannotator");

function run(command, commandArgs, options = {}) {
  console.log(`\n==> ${options.label || `${command} ${commandArgs.join(" ")}`}`);
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function hasCommand(command) {
  const probe = spawnSync(command, ["--version"], {
    cwd: root,
    stdio: "ignore",
    shell: process.platform === "win32",
  });
  return !probe.error && probe.status === 0;
}

console.log("Pi Remote host extension builder/installer");
console.log(`Repository: ${root}`);

if (!hasCommand("corepack")) {
  console.error("Node.js with Corepack is required. Install Node.js 22 or newer first.");
  process.exit(1);
}
if (!hasCommand("pi")) {
  console.error("The Pi CLI is not on PATH. Install Pi before running this file.");
  process.exit(1);
}

run("corepack", ["prepare", "pnpm@10.14.0", "--activate"], { label: "Activating pnpm 10.14.0 through Corepack" });
run("corepack", ["pnpm", "install", "--frozen-lockfile"], { label: "Installing locked build dependencies" });

if (!skipTests) {
  run("corepack", ["pnpm", "test"], { label: "Running focused tests" });
  run("corepack", ["pnpm", "-r", "typecheck"], { label: "Type-checking all packages" });
}

run("corepack", ["pnpm", "--filter", "@pi-remote/pi-extension", "bundle"], { label: "Building the self-contained Pi extension" });

const extensionDir = resolve(root, "packages/pi-remote/dist");
if (!existsSync(resolve(extensionDir, "index.mjs"))) {
  console.error(`Build completed without producing ${resolve(extensionDir, "index.mjs")}`);
  process.exit(1);
}

// Local Pi packages remain registered by absolute path. Re-running this command
// updates the built files in place and makes installation idempotent.
run("pi", ["install", extensionDir], { label: "Installing or refreshing the Pi Remote extension" });

if (!skipPlannotator) {
  run("pi", ["install", "npm:@plannotator/pi-extension"], { label: "Ensuring Plannotator is installed" });
  run("pi", ["update", "--extension", "npm:@plannotator/pi-extension"], { label: "Updating Plannotator" });
}

console.log("\nHost extension installation complete.");
console.log("Restart any running Pi process so it reloads the extension.");
console.log("The extension generates and securely stores a random token on first load.");
console.log("Run /pi-remote in Pi, then choose Display token to copy it into the desktop profile.");
console.log("Choose Generate new token from the same menu whenever the token should be rotated.");
console.log("\nOptional port settings before starting Pi:");
if (process.platform === "win32") {
  console.log("  $env:PI_REMOTE_PORT=\"31415\"");
  console.log("  $env:PLANNOTATOR_REMOTE=\"1\"");
  console.log("  $env:PLANNOTATOR_PORT=\"19432\"");
} else {
  console.log("  export PI_REMOTE_PORT=31415");
  console.log("  export PLANNOTATOR_REMOTE=1");
  console.log("  export PLANNOTATOR_PORT=19432");
}
