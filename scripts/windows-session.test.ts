import { describe, expect, it, vi } from "vitest";
import { assertInteractiveWindowsSession, readWindowsSessionId } from "./windows-session.mjs";

describe("Windows host session detection", () => {
  it("skips detection outside Windows", () => {
    const run = vi.fn();
    expect(readWindowsSessionId({ platform: "linux", run })).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it("accepts an interactive Windows session", () => {
    const run = vi.fn(() => ({ status: 0, stdout: "1\r\n", stderr: "" }));
    expect(assertInteractiveWindowsSession({ platform: "win32", run })).toBe(1);
  });

  it("rejects Windows Session 0", () => {
    const run = vi.fn(() => ({ status: 0, stdout: "0\r\n", stderr: "" }));
    expect(() => assertInteractiveWindowsSession({ platform: "win32", run })).toThrow("Session 0");
  });

  it("rejects an invalid session response", () => {
    const run = vi.fn(() => ({ status: 0, stdout: "unknown", stderr: "" }));
    expect(() => readWindowsSessionId({ platform: "win32", run })).toThrow("invalid session identifier");
  });
});
