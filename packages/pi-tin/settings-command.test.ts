import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import piTin from "./index";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const temporaryDirectories: string[] = [];

afterEach(() => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("Pi Tin settings command", () => {
  it("is the single extension command and can display or rotate the generated token", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-tin-test-"));
    temporaryDirectories.push(agentDir);
    process.env.PI_CODING_AGENT_DIR = agentDir;

    const commands = new Map<string, any>();
    const fakePi = {
      registerCommand: vi.fn((name: string, options: unknown) => commands.set(name, options)),
      on: vi.fn(),
      events: { emit: vi.fn(), on: vi.fn() },
    };
    piTin(fakePi as any);

    expect([...commands.keys()]).toEqual(["pi-tin"]);
    const command = commands.get("pi-tin");
    const notify = vi.fn();
    const select = vi.fn()
      .mockResolvedValueOnce("Display token")
      .mockResolvedValueOnce("Generate new token");
    const ctx = { ui: { select, notify } };

    await command.handler("", ctx);
    const displayed = String(notify.mock.calls[0]?.[0]).replace("Pi Tin token: ", "");
    expect(displayed).toMatch(/^[A-Za-z0-9_-]{32,128}$/);

    await command.handler("", ctx);
    const generated = String(notify.mock.calls[1]?.[0]).replace("New Pi Tin token: ", "");
    expect(generated).toMatch(/^[A-Za-z0-9_-]{32,128}$/);
    expect(generated).not.toBe(displayed);

    const persisted = JSON.parse(readFileSync(join(agentDir, "pi-tin.json"), "utf8"));
    expect(persisted.token).toBe(generated);
    expect(select).toHaveBeenCalledWith("Pi Tin settings", ["Generate new token", "Display token"]);
  });

  it("migrates an existing Pi Remote token", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-tin-migration-test-"));
    temporaryDirectories.push(agentDir);
    process.env.PI_CODING_AGENT_DIR = agentDir;
    const token = "a".repeat(32);
    writeFileSync(join(agentDir, "pi-remote.json"), JSON.stringify({ token }));

    const commands = new Map<string, any>();
    piTin({ registerCommand: (name: string, options: unknown) => commands.set(name, options) } as any);
    const notify = vi.fn();
    await commands.get("pi-tin").handler("", { ui: { select: vi.fn().mockResolvedValue("Display token"), notify } });

    expect(notify).toHaveBeenCalledWith(`Pi Tin token: ${token}`, "info");
    expect(JSON.parse(readFileSync(join(agentDir, "pi-tin.json"), "utf8")).token).toBe(token);
  });
});
