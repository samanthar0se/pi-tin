import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RpcClient, type RpcExtensionUIResponse } from "@earendil-works/pi-coding-agent";
import { PROTOCOL_VERSION, type ClientCommand, type ExtensionUiRequest, type ServerMessage, type Snapshot } from "@pi-tin/protocol";
import { createTokenStore } from "../../pi-tin/token-store.ts";
import { ReviewTracker } from "./plannotator.ts";
import type { HostBackend } from "./types.ts";

const PLAN_TOOL = "plannotator_submit_plan";
const agentDir = process.env.PI_CODING_AGENT_DIR || resolve(homedir(), ".pi", "agent");
const statePath = resolve(agentDir, "pi-tin-host.json");
const legacyStatePath = resolve(agentDir, "pi-remote-host.json");

type RpcStatus = "starting" | "ready" | "error" | "stopped";

export class HostController implements HostBackend {
  private rpc: RpcClient | null = null;
  private listeners = new Set<(message: ServerMessage) => void>();
  private activePath: string | null = null;
  private cwd = process.env.PI_TIN_CWD || process.env.PI_REMOTE_CWD || process.cwd();
  private running = false;
  private rpcStatus: RpcStatus = "stopped";
  private planPhase: Snapshot["planPhase"] = "idle";
  private healthTimer: NodeJS.Timeout | null = null;
  private recovering = false;
  private pendingUiRequest: ExtensionUiRequest | null = null;
  readonly tokenStore = createTokenStore();
  readonly review: ReviewTracker;

  constructor() {
    const port = Number(process.env.PLANNOTATOR_PORT || 19432);
    this.review = new ReviewTracker(`http://localhost:${port}`, (message) => {
      this.emit(message);
      this.emitHostState();
    });
  }

  authenticate(candidate: string): boolean {
    const expected = this.tokenStore.get();
    if (!expected || expected.length !== candidate.length) return false;
    let mismatch = 0;
    for (let index = 0; index < expected.length; index++) mismatch |= expected.charCodeAt(index) ^ candidate.charCodeAt(index);
    return mismatch === 0;
  }

  subscribe(listener: (message: ServerMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start(): Promise<void> {
    const saved = readHostState();
    this.cwd = saved.cwd && existsSync(saved.cwd) ? saved.cwd : this.cwd;
    await this.startRpc(this.cwd, saved.sessionPath && existsSync(saved.sessionPath) ? saved.sessionPath : undefined);
    this.healthTimer = setInterval(() => void this.checkRpcHealth(), 5_000);
  }

  async stop(): Promise<void> {
    if (this.healthTimer) clearInterval(this.healthTimer);
    this.healthTimer = null;
    this.rpcStatus = "stopped";
    this.pendingUiRequest = null;
    this.emitHostState();
    await this.rpc?.stop();
    this.rpc = null;
  }

  async initialMessages(): Promise<ServerMessage[]> {
    return [this.hostState(), await this.snapshot(), ...(this.pendingUiRequest ? [this.pendingUiRequest] : [])];
  }

  async handle(command: ClientCommand): Promise<{ data?: unknown }> {
    if (command.type === "restart_pi") return { data: await this.restartRpc() };
    if (command.type === "new_session") return { data: await this.newSession() };
    if (command.type === "extension_ui_response") { await this.respondToExtensionUi(command); return {}; }
    const rpc = this.requireRpc();
    switch (command.type) {
      case "prompt": await rpc.prompt(command.message); return {};
      case "steer": await rpc.steer(command.message); return {};
      case "follow_up": await rpc.followUp(command.message); return {};
      case "abort": await rpc.abort(); return {};
      case "set_model": return { data: await rpc.setModel(command.provider, command.modelId) };
      case "set_thinking": await rpc.setThinkingLevel(command.level as any); return { data: { level: command.level } };
      case "compact": return { data: await rpc.compact(command.customInstructions) };
      case "set_plan_mode": return { data: await this.setPlanMode(command.mode) };
      case "start_code_review": return { data: await this.startCodeReview() };
    }
  }

  private async newSession(): Promise<{ cancelled: boolean; sessionFile: string | null }> {
    if (this.running) throw new Error("Stop Pi before starting a new session.");
    if (this.review.active) throw new Error("Finish the active review before starting a new session.");
    const result = await this.requireRpc().newSession();
    if (result.cancelled) return { cancelled: true, sessionFile: this.activePath };
    this.running = false;
    this.planPhase = "idle";
    const state = await this.requireRpc().getState();
    this.activePath = state.sessionFile || null;
    this.persist();
    this.emitHostState();
    this.emit(await this.snapshot());
    return { cancelled: false, sessionFile: this.activePath };
  }

  private async restartRpc(): Promise<{ sessionFile: string | null }> {
    if (this.rpcStatus === "starting" || this.recovering) throw new Error("Pi is already restarting.");
    if (this.review.active) throw new Error("Finish the active review before restarting Pi.");
    const rpc = this.rpc;
    if (rpc) {
      try {
        const state = await rpc.getState();
        this.activePath = state.sessionFile || this.activePath;
        this.persist();
      } catch {}
    }
    this.rpc = null;
    this.running = false;
    this.pendingUiRequest = null;
    this.rpcStatus = "starting";
    this.emitHostState();
    if (rpc) try { await rpc.stop(); } catch {}
    await this.startRpc(this.cwd, this.activePath && existsSync(this.activePath) ? this.activePath : undefined);
    this.emit(await this.snapshot());
    return { sessionFile: this.activePath };
  }

  private async startRpc(cwd: string, sessionPath?: string): Promise<void> {
    this.rpcStatus = "starting";
    this.emitHostState();
    const rpcEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry"));
    const cliPath = resolve(dirname(rpcEntry), "cli.js");
    const rpc = new RpcClient({ cliPath, cwd, args: sessionPath ? ["--session", sessionPath] : [], env: { PLANNOTATOR_REMOTE: "1" } });
    rpc.onEvent((event) => this.onRpcEvent(event as any));
    try {
      await rpc.start();
      this.rpc = rpc;
      this.cwd = cwd;
      this.rpcStatus = "ready";
      const state = await rpc.getState();
      this.activePath = state.sessionFile || null;
      this.running = state.isStreaming;
      this.persist();
      this.emitHostState();
    } catch (error) {
      this.rpcStatus = "error";
      this.emit({ type: "host_state", rpcStatus: "error", activeReviewId: this.review.active?.id ?? null, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  private onRpcEvent(event: any): void {
    if (event.type === "extension_ui_request") {
      const request = event as ExtensionUiRequest;
      if (["select", "confirm", "input", "editor"].includes(request.method)) this.pendingUiRequest = request;
      this.emit(request);
      return;
    }
    if (event.type === "agent_start") this.running = true;
    if (event.type === "agent_settled") {
      this.running = false;
      this.pendingUiRequest = null;
    }
    if (event.type === "tool_execution_start" && event.toolName === PLAN_TOOL && !this.review.active) {
      this.planPhase = "reviewing";
      this.review.start("plan", String(event.toolCallId));
    }
    if (event.type === "tool_execution_end" && event.toolName === PLAN_TOOL) {
      const approved = Boolean(event.result?.details?.approved);
      this.planPhase = approved ? "executing" : "planning";
      this.review.finish({ approved, ...(event.isError ? { error: "Plan review failed." } : {}) });
    }
    if (event.type === "session_info_changed" || event.type === "agent_settled") void this.captureSessionPath();
    this.emit({ type: "event", event });
    if (event.type === "agent_settled" || event.type === "compaction_end" || event.type === "model_select") void this.emitContextUsage();
    this.emitHostState();
  }

  private async respondToExtensionUi(command: Extract<ClientCommand, { type: "extension_ui_response" }>): Promise<void> {
    const request = this.pendingUiRequest;
    if (!request || request.id !== command.uiRequestId) throw new Error("This Pi dialog is no longer active.");
    if (!command.cancelled && request.method === "confirm" && command.confirmed === undefined) throw new Error("Confirmation response is missing.");
    if (!command.cancelled && request.method !== "confirm" && command.value === undefined) throw new Error("Dialog response is missing.");
    const response: RpcExtensionUIResponse = command.cancelled
      ? { type: "extension_ui_response", id: request.id, cancelled: true }
      : request.method === "confirm"
        ? { type: "extension_ui_response", id: request.id, confirmed: Boolean(command.confirmed) }
        : { type: "extension_ui_response", id: request.id, value: command.value! };
    const rpc = this.requireRpc() as unknown as { process?: { stdin?: { destroyed?: boolean; writable?: boolean; write: (data: string) => void } } };
    const stdin = rpc.process?.stdin;
    if (!stdin || stdin.destroyed || stdin.writable === false) throw new Error("Pi RPC input is unavailable.");
    this.pendingUiRequest = null;
    stdin.write(`${JSON.stringify(response)}\n`);
  }

  private async emitContextUsage(): Promise<void> {
    try {
      const contextUsage = (await this.requireRpc().getSessionStats()).contextUsage ?? null;
      this.emit({ type: "event", event: { type: "context_usage", contextUsage } });
    } catch {}
  }

  private async captureSessionPath(): Promise<void> {
    try {
      const state = await this.requireRpc().getState();
      this.activePath = state.sessionFile || this.activePath;
      this.persist();
    } catch {}
  }

  private async setPlanMode(mode: "enter" | "exit" | "toggle" | "status"): Promise<{ phase: Snapshot["planPhase"] }> {
    if (mode === "status") return { phase: this.planPhase };
    const shouldToggle = mode === "toggle" || (mode === "enter" && this.planPhase === "idle") || (mode === "exit" && this.planPhase !== "idle");
    if (shouldToggle) {
      await this.requireRpc().prompt("/plannotator");
      this.planPhase = this.planPhase === "idle" ? "planning" : "idle";
      this.emit({ type: "event", event: { type: "plan_phase", phase: this.planPhase } });
    }
    return { phase: this.planPhase };
  }

  private async startCodeReview(): Promise<{ reviewId: string }> {
    if (this.running) throw new Error("Wait for Pi to finish before starting code review.");
    const id = this.review.start("code");
    try {
      await this.requireRpc().prompt("/plannotator-review");
      void this.review.watchCodeReview(Number(process.env.PLANNOTATOR_PORT || 19432));
      return { reviewId: id };
    } catch (error) {
      this.review.finish({ error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  private async snapshot(): Promise<Snapshot> {
    const rpc = this.requireRpc();
    const [state, entries, models, commands] = await Promise.all([rpc.getState(), rpc.getEntries(), rpc.getAvailableModels(), rpc.getCommands()]);
    let contextUsage: Snapshot["contextUsage"] = null;
    try { contextUsage = ((await rpc.getSessionStats()).contextUsage as Snapshot["contextUsage"]) ?? null; } catch {}
    this.activePath = state.sessionFile || this.activePath;
    this.persist();
    return {
      type: "snapshot", version: PROTOCOL_VERSION, sessionFile: state.sessionFile || null, sessionName: state.sessionName || null,
      cwd: this.cwd, entries: entries.entries, model: (state.model as any) || null, availableModels: models as any[],
      commands: commands.map((command) => ({ name: command.name, description: command.description, source: command.source, scope: command.sourceInfo.scope })),
      thinkingLevel: state.thinkingLevel, isRunning: state.isStreaming, contextUsage, planPhase: this.planPhase,
    };
  }

  private async checkRpcHealth(): Promise<void> {
    if (this.recovering || this.rpcStatus !== "ready" || !this.rpc) return;
    try {
      await this.rpc.getState();
    } catch {
      this.recovering = true;
      this.rpcStatus = "error";
      this.emitHostState();
      try {
        await this.rpc?.stop();
        this.rpc = null;
        await this.startRpc(this.cwd, this.activePath && existsSync(this.activePath) ? this.activePath : undefined);
        this.emit(await this.snapshot());
      } catch (error) {
        this.emit({ type: "host_state", rpcStatus: "error", activeReviewId: this.review.active?.id ?? null, error: error instanceof Error ? error.message : String(error) });
      } finally {
        this.recovering = false;
      }
    }
  }

  private hostState(): ServerMessage { return { type: "host_state", rpcStatus: this.rpcStatus, activeReviewId: this.review.active?.id ?? null }; }
  private emitHostState(): void { this.emit(this.hostState()); }
  private emit(message: ServerMessage): void { for (const listener of this.listeners) listener(message); }
  private requireRpc(): RpcClient {
    if (!this.rpc || this.rpcStatus === "error" || this.rpcStatus === "stopped") throw new Error("Pi RPC runtime is unavailable.");
    return this.rpc;
  }
  private persist(): void {
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(statePath, JSON.stringify({ cwd: this.cwd, sessionPath: this.activePath }, null, 2));
  }
}

function readHostState(): { cwd?: string; sessionPath?: string } {
  for (const path of [statePath, legacyStatePath]) {
    try { return JSON.parse(readFileSync(path, "utf8")); } catch {}
  }
  return {};
}
