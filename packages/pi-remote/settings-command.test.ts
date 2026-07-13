import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import piRemote from "./index";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const temporaryDirectories: string[] = [];

afterEach(() => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("Pi Remote settings command", () => {
  it("is the single extension command and can display or rotate the generated token", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-remote-test-"));
    temporaryDirectories.push(agentDir);
    process.env.PI_CODING_AGENT_DIR = agentDir;

    const commands = new Map<string, any>();
    const fakePi = {
      registerCommand: vi.fn((name: string, options: unknown) => commands.set(name, options)),
      on: vi.fn(),
      events: { emit: vi.fn(), on: vi.fn() },
    };
    piRemote(fakePi as any);

    expect([...commands.keys()]).toEqual(["pi-remote"]);
    const command = commands.get("pi-remote");
    const notify = vi.fn();
    const select = vi.fn()
      .mockResolvedValueOnce("Display token")
      .mockResolvedValueOnce("Generate new token");
    const ctx = { ui: { select, notify } };

    await command.handler("", ctx);
    const displayed = String(notify.mock.calls[0]?.[0]).replace("Pi Remote token: ", "");
    expect(displayed).toMatch(/^[A-Za-z0-9_-]{32,128}$/);

    await command.handler("", ctx);
    const generated = String(notify.mock.calls[1]?.[0]).replace("New Pi Remote token: ", "");
    expect(generated).toMatch(/^[A-Za-z0-9_-]{32,128}$/);
    expect(generated).not.toBe(displayed);

    const persisted = JSON.parse(readFileSync(join(agentDir, "pi-remote.json"), "utf8"));
    expect(persisted.token).toBe(generated);
    expect(select).toHaveBeenCalledWith("Pi Remote settings", ["Generate new token", "Display token"]);
  });
});
