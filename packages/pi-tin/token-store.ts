import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface TokenStore {
  get(): string;
  rotate(): string;
  path: string;
}

export function defaultTokenPath(): string {
  const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
  return join(agentDir, "pi-tin.json");
}

export function createTokenStore(path = defaultTokenPath()): TokenStore {
  let existingToken = readToken(path);
  if (!existingToken && path === defaultTokenPath()) existingToken = readToken(legacyTokenPath());
  if (existingToken && !existsSync(path)) writeToken(path, existingToken);
  let token = existingToken || generateAndWriteToken(path);
  return {
    path,
    get: () => {
      token = readToken(path) || token;
      return token;
    },
    rotate: () => {
      token = generateAndWriteToken(path);
      return token;
    },
  };
}

function legacyTokenPath(): string {
  const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
  return join(agentDir, "pi-remote.json");
}

function readToken(path: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { token?: unknown };
    return typeof parsed.token === "string" && /^[A-Za-z0-9_-]{32,128}$/.test(parsed.token)
      ? parsed.token
      : null;
  } catch {
    return null;
  }
}

function generateAndWriteToken(path: string): string {
  const token = randomBytes(32).toString("base64url");
  writeToken(path, token);
  return token;
}

function writeToken(path: string, token: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify({ token }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporaryPath, path);
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows and some network filesystems do not expose POSIX mode bits.
  }
}
