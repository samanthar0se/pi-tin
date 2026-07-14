import { spawnSync } from "node:child_process";

export function readWindowsSessionId({ platform = process.platform, run = spawnSync } = {}) {
  if (platform !== "win32") return null;
  const result = run("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "(Get-Process -Id $PID).SessionId",
  ], { encoding: "utf8", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim();
    throw new Error(detail || "Could not determine the current Windows session.");
  }
  const sessionId = Number(String(result.stdout).trim());
  if (!Number.isInteger(sessionId) || sessionId < 0) {
    throw new Error("Windows returned an invalid session identifier.");
  }
  return sessionId;
}

export function assertInteractiveWindowsSession(options) {
  const sessionId = readWindowsSessionId(options);
  if (sessionId === 0) {
    throw new Error("Refusing to start in Windows Session 0. Sign in to the visible Windows desktop and launch Pi Tin there, or run .\\configure-host-startup-windows.ps1. Computer-use extensions cannot access the desktop from Session 0.");
  }
  return sessionId;
}
