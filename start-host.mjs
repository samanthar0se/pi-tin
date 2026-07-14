#!/usr/bin/env node
import { assertInteractiveWindowsSession } from "./scripts/windows-session.mjs";

try {
  assertInteractiveWindowsSession();
} catch (error) {
  console.error(`[pi-tin] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

await import("./packages/host/dist/index.mjs");
