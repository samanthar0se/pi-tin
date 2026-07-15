import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpcHarness = vi.hoisted(() => ({
  instances: [] as any[],
  configurations: [] as Array<(rpc: any) => void>,
}));

vi.mock("@earendil-works/pi-coding-agent", () => {
  class RpcClient {
    start = vi.fn(async () => {});
    stop = vi.fn(async () => {});
    getState = vi.fn(async () => ({
      sessionFile: null,
      sessionName: null,
      isStreaming: false,
      model: null,
      thinkingLevel: "medium",
    }));
    getEntries = vi.fn(async () => ({ entries: [] }));
    getAvailableModels = vi.fn(async () => []);
    getCommands = vi.fn(async () => []);
    getSessionStats = vi.fn(async () => ({ contextUsage: null }));
    onEvent = vi.fn();

    constructor(_options: unknown) {
      rpcHarness.instances.push(this);
      rpcHarness.configurations.shift()?.(this);
    }
  }

  return { RpcClient };
});

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
let agentDir: string;

beforeEach(() => {
  vi.resetModules();
  rpcHarness.instances.length = 0;
  rpcHarness.configurations.length = 0;
  agentDir = mkdtempSync(join(tmpdir(), "pi-tin-controller-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  rmSync(agentDir, { recursive: true, force: true });
});

describe("host controller persistence", () => {
  it("restores a deliberately empty session list without creating a fallback session", async () => {
    writeState({ version: 2, sessions: [{ id: "session-1", cwd: agentDir }] });
    const { HostController } = await import("./controller");
    const controller = new HostController(fakeCliPath());
    await controller.start();

    await controller.handle({ type: "close_session", id: "close-1", sessionId: "session-1" });
    expect(JSON.parse(readFileSync(stateFile(), "utf8")).sessions).toEqual([]);

    const restarted = new HostController(fakeCliPath());
    await restarted.start();
    expect(await sessionDescriptors(restarted)).toEqual([]);
    expect(rpcHarness.instances).toHaveLength(1);

    await controller.stop();
    await restarted.stop();
  });

  it("reports invalid saved records and falls back to a usable default session", async () => {
    writeState({ version: 2, sessions: [{ id: "broken", cwd: join(agentDir, "missing") }] });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { HostController } = await import("./controller");
    const controller = new HostController(fakeCliPath());

    await controller.start();
    expect(await sessionDescriptors(controller)).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/invalid session record 0/i));
    expect(readdirSync(agentDir).some((name) => name.startsWith("pi-tin-host.json.invalid-"))).toBe(true);

    await controller.stop();
  });

  it("replays an active review when a desktop reconnects", async () => {
    writeState({ version: 2, sessions: [{ id: "session-1", cwd: agentDir }] });
    const { HostController } = await import("./controller");
    const controller = new HostController(fakeCliPath());
    await controller.start();
    controller.review.start("session-1", "plan", "review-1");

    expect(await controller.initialMessages()).toContainEqual({
      type: "review_started",
      sessionId: "session-1",
      reviewId: "review-1",
      kind: "plan",
      url: "http://localhost:19432",
    });

    await controller.stop();
  });

  it("returns the existing runtime when the same working directory is opened twice", async () => {
    writeState({ version: 2, sessions: [] });
    const { HostController } = await import("./controller");
    const controller = new HostController(fakeCliPath());
    await controller.start();

    const first = await controller.handle({ type: "create_session", id: "create-1", cwd: agentDir });
    const second = await controller.handle({ type: "create_session", id: "create-2", cwd: agentDir });

    expect(second.data).toEqual(first.data);
    expect(await sessionDescriptors(controller)).toHaveLength(1);
    await flushMicrotasks();
    expect(rpcHarness.instances).toHaveLength(1);

    await controller.stop();
  });
});

describe("Pi runtime lifecycle", () => {
  it("waits for an in-progress start before closing and stops the started RPC", async () => {
    writeState({ version: 2, sessions: [] });
    const startGate = deferred<void>();
    rpcHarness.configurations.push((rpc) => rpc.start.mockImplementation(() => startGate.promise));
    const { HostController } = await import("./controller");
    const controller = new HostController(fakeCliPath());
    await controller.start();

    const created = await controller.handle({ type: "create_session", id: "create-1", cwd: agentDir });
    const sessionId = (created.data as { sessionId: string }).sessionId;
    await flushMicrotasks();
    expect(rpcHarness.instances).toHaveLength(1);

    let closed = false;
    const close = controller.handle({ type: "close_session", id: "close-1", sessionId }).then(() => { closed = true; });
    await flushMicrotasks();
    expect(closed).toBe(false);

    startGate.resolve();
    await close;
    expect(rpcHarness.instances[0].stop).toHaveBeenCalledTimes(1);
    expect(await sessionDescriptors(controller)).toEqual([]);

    await controller.stop();
  });

  it("queues close behind health recovery and stops the replacement RPC", async () => {
    vi.useFakeTimers();
    writeState({ version: 2, sessions: [{ id: "session-1", cwd: agentDir }] });
    rpcHarness.configurations.push((rpc) => {
      let stateReads = 0;
      rpc.getState.mockImplementation(async () => {
        stateReads += 1;
        if (stateReads === 3) throw new Error("RPC exited");
        return readyState();
      });
    });
    const recoveryStartGate = deferred<void>();
    rpcHarness.configurations.push((rpc) => rpc.start.mockImplementation(() => recoveryStartGate.promise));
    const { HostController } = await import("./controller");
    const controller = new HostController(fakeCliPath());
    await controller.start();

    await vi.advanceTimersByTimeAsync(5_000);
    await flushMicrotasks();
    expect(rpcHarness.instances).toHaveLength(2);

    let closed = false;
    const close = controller.handle({ type: "close_session", id: "close-1", sessionId: "session-1" }).then(() => { closed = true; });
    await flushMicrotasks();
    expect(closed).toBe(false);

    recoveryStartGate.resolve();
    await close;
    expect(rpcHarness.instances[0].stop).toHaveBeenCalledTimes(1);
    expect(rpcHarness.instances[1].stop).toHaveBeenCalledTimes(1);
    expect(await sessionDescriptors(controller)).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);

    await controller.stop();
  });

  it("rejects commands queued during close instead of reviving a removed runtime", async () => {
    writeState({ version: 2, sessions: [{ id: "session-1", cwd: agentDir }] });
    const stopGate = deferred<void>();
    rpcHarness.configurations.push((rpc) => rpc.stop.mockImplementation(() => stopGate.promise));
    const { HostController } = await import("./controller");
    const controller = new HostController(fakeCliPath());
    await controller.start();

    const close = controller.handle({ type: "close_session", id: "close-1", sessionId: "session-1" });
    await flushMicrotasks();
    const restart = controller.handle({ type: "restart_pi", id: "restart-1", sessionId: "session-1" });
    const reopen = controller.handle({ type: "create_session", id: "create-1", cwd: agentDir });

    await expect(restart).rejects.toThrow(/closing/i);
    await expect(reopen).rejects.toThrow(/still closing/i);
    stopGate.resolve();
    await close;
    expect(await sessionDescriptors(controller)).toEqual([]);
    expect(rpcHarness.instances).toHaveLength(1);

    await controller.stop();
  });

  it("installs one health monitor after a successful retry and keeps it idempotent across restarts", async () => {
    vi.useFakeTimers();
    writeState({ version: 2, sessions: [{ id: "session-1", cwd: agentDir }] });
    rpcHarness.configurations.push((rpc) => rpc.start.mockRejectedValue(new Error("first start failed")));
    const { HostController } = await import("./controller");
    const controller = new HostController(fakeCliPath());
    await controller.start();
    expect(vi.getTimerCount()).toBe(0);

    await controller.handle({ type: "restart_pi", id: "restart-1", sessionId: "session-1" });
    expect(vi.getTimerCount()).toBe(1);

    await controller.handle({ type: "restart_pi", id: "restart-2", sessionId: "session-1" });
    expect(vi.getTimerCount()).toBe(1);

    await controller.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});

function stateFile(): string {
  return join(agentDir, "pi-tin-host.json");
}

function fakeCliPath(): string {
  return join(agentDir, "cli.js");
}

function writeState(value: unknown): void {
  writeFileSync(stateFile(), JSON.stringify(value));
}

async function sessionDescriptors(controller: { initialMessages(): Promise<any[]> }): Promise<any[]> {
  const message = (await controller.initialMessages()).find((candidate) => candidate.type === "session_list");
  return message?.sessions ?? [];
}

function readyState(): Record<string, unknown> {
  return {
    sessionFile: null,
    sessionName: null,
    isStreaming: false,
    model: null,
    thinkingLevel: "medium",
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T | PromiseLike<T>) => void } {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}
