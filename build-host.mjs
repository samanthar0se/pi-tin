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

console.log("Pi Tin host extension builder/installer");
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

run("corepack", ["pnpm", "--filter", "@pi-tin/pi-extension", "bundle"], { label: "Building the Pi settings extension" });
run("corepack", ["pnpm", "--filter", "@pi-tin/host", "bundle"], { label: "Building the Pi Tin host controller" });

const installedPackages = spawnSync("pi", ["list"], {
  cwd: root,
  encoding: "utf8",
  shell: process.platform === "win32",
});
const legacyExtensionSource = installedPackages.stdout
  ?.split(/\r?\n/)
  .map((line) => line.trim())
  .find((line) => line.replaceAll("\\", "/").endsWith("/packages/pi-remote/dist"));
if (legacyExtensionSource) {
  run("pi", ["remove", legacyExtensionSource], { label: "Removing the legacy Pi Remote extension registration" });
}

const extensionDir = resolve(root, "packages/pi-tin/dist");
if (!existsSync(resolve(extensionDir, "index.mjs"))) {
  console.error(`Build completed without producing ${resolve(extensionDir, "index.mjs")}`);
  process.exit(1);
}

// Local Pi packages remain registered by absolute path. Re-running this command
// updates the built files in place and makes installation idempotent.
run("pi", ["install", extensionDir], { label: "Installing or refreshing the Pi Tin extension" });

if (process.platform === "win32") {
  run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", resolve(root, "configure-host-startup-windows.ps1")], {
    label: "Installing the interactive Windows host startup shortcut",
  });
}

if (!skipPlannotator) {
  run("pi", ["install", "npm:@plannotator/pi-extension"], { label: "Ensuring Plannotator is installed" });
  run("pi", ["update", "--extension", "npm:@plannotator/pi-extension"], { label: "Updating Plannotator" });
}

console.log("\nHost controller build and settings extension installation complete.");
console.log("Restart any running Pi process so it reloads the settings extension.");
console.log("Start remote session control with: node ./start-host.mjs");
console.log("The host prints its generated token at startup; /pi-tin can also display or rotate it in a TUI.");
if (process.platform === "win32") console.log("Windows starts the foreground host after interactive sign-in; Session 0 launches are rejected so computer-use extensions can access the desktop.");
console.log("\nOptional port settings before starting Pi:");
if (process.platform === "win32") {
  console.log("  $env:PI_TIN_PORT=\"31415\"");
  console.log("  $env:PLANNOTATOR_REMOTE=\"1\"");
  console.log("  $env:PLANNOTATOR_PORT=\"19432\"");
} else {
  console.log("  export PI_TIN_PORT=31415");
  console.log("  export PLANNOTATOR_REMOTE=1");
  console.log("  export PLANNOTATOR_PORT=19432");
}
