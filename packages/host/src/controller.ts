import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RpcClient, SessionManager, type RpcSessionState } from "@earendil-works/pi-coding-agent";
import type { ClientCommand, ServerMessage, Snapshot } from "@pi-remote/protocol";
import { createTokenStore } from "../../pi-remote/token-store.ts";
import { assertSessionSwitchAllowed, buildSessionCatalog, resolveCatalogSession, type CatalogRecord } from "./session-catalog.ts";
import { ReviewTracker } from "./plannotator.ts";
import type { HostBackend } from "./types.ts";

const PLAN_TOOL = "plannotator_submit_plan";
const agentDir = process.env.PI_CODING_AGENT_DIR || resolve(homedir(), ".pi", "agent");
const statePath = resolve(agentDir, "pi-remote-host.json");

export class HostController implements HostBackend {
  private rpc: RpcClient | null = null;
  private listeners = new Set<(message: ServerMessage) => void>();
  private catalog: CatalogRecord[] = [];
  private activePath: string | null = null;
  private cwd = process.env.PI_REMOTE_CWD || process.cwd();
  private running = false;
  private rpcStatus: "starting" | "ready" | "switching" | "error" | "stopped" = "stopped";
  private planPhase: Snapshot["planPhase"] = "idle";
  private healthTimer: NodeJS.Timeout | null = null;
  private recovering = false;
  readonly tokenStore = createTokenStore();
  readonly review: ReviewTracker;

  constructor() {
    const port = Number(process.env.PLANNOTATOR_PORT || 19432);
    this.review = new ReviewTracker(`http://localhost:${port}`, (message) => {
      this.emit(message);
      void this.refreshCatalog();
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
    await this.refreshCatalog();
    this.healthTimer = setInterval(() => void this.checkRpcHealth(), 5_000);
  }

  async stop(): Promise<void> {
    if (this.healthTimer) clearInterval(this.healthTimer);
    this.healthTimer = null;
    this.rpcStatus = "stopped"; this.emitHostState();
    await this.rpc?.stop(); this.rpc = null;
  }

  async initialMessages(): Promise<ServerMessage[]> {
    return [this.hostState(), this.catalogMessage(), await this.snapshot()];
  }

  async handle(command: ClientCommand): Promise<{ data?: unknown }> {
    const rpc = this.requireRpc();
    switch (command.type) {
      case "prompt": await rpc.prompt(command.message); return {};
      case "steer": await rpc.steer(command.message); return {};
      case "follow_up": await rpc.followUp(command.message); return {};
      case "abort": await rpc.abort(); return {};
      case "set_model": return { data: await rpc.setModel(command.provider, command.modelId) };
      case "set_thinking": await rpc.setThinkingLevel(command.level as any); return { data: { level: command.level } };
      case "compact": return { data: await rpc.compact(command.customInstructions) };
      case "list_sessions": await this.refreshCatalog(); return { data: this.catalogMessage() };
      case "switch_session": return { data: await this.switchSession(command.sessionId) };
      case "new_session": return { data: await this.newSession(command.cwd) };
      case "set_plan_mode": return { data: await this.setPlanMode(command.mode) };
      case "start_code_review": return { data: await this.startCodeReview() };
    }
  }

  private async startRpc(cwd: string, sessionPath?: string): Promise<void> {
    this.rpcStatus = "starting"; this.emitHostState();
    const rpcEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry"));
    const cliPath = resolve(dirname(rpcEntry), "cli.js");
    const args = sessionPath ? ["--session", sessionPath] : [];
    const rpc = new RpcClient({ cliPath, cwd, args, env: { PLANNOTATOR_REMOTE: "1" } });
    rpc.onEvent((event) => this.onRpcEvent(event as any));
    try {
      await rpc.start();
      this.rpc = rpc; this.cwd = cwd; this.rpcStatus = "ready";
      const state = await rpc.getState();
      this.activePath = state.sessionFile || null;
      this.running = state.isStreaming;
      this.persist(); this.emitHostState();
    } catch (error) {
      this.rpcStatus = "error";
      this.emit({ type: "host_state", rpcStatus: "error", activeReviewId: this.review.active?.id ?? null, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  private onRpcEvent(event: any): void {
    if (event.type === "agent_start") this.running = true;
    if (event.type === "agent_settled") this.running = false;
    if (event.type === "tool_execution_start" && event.toolName === PLAN_TOOL && !this.review.active) {
      this.planPhase = "reviewing";
      this.review.start("plan", String(event.toolCallId));
    }
    if (event.type === "tool_execution_end" && event.toolName === PLAN_TOOL) {
      const approved = Boolean(event.result?.details?.approved);
      this.planPhase = approved ? "executing" : "planning";
      this.review.finish({ approved, ...(event.isError ? { error: "Plan review failed." } : {}) });
    }
    if (event.type === "session_info_changed" || event.type === "agent_start" || event.type === "agent_settled") void this.refreshCatalog();
    this.emit({ type: "event", event });
    this.emitHostState();
  }

  private async switchSession(id: string): Promise<{ cancelled: boolean }> {
    this.assertCanSwitch();
    const record = resolveCatalogSession(this.catalog, id);
    if (!record) throw new Error("Session is not in the current host catalog.");
    this.rpcStatus = "switching";
    this.emit({ type: "session_switching", sessionId: id }); this.emitHostState();
    try {
      const result = await this.requireRpc().switchSession(record.path);
      if (!result.cancelled) {
        this.activePath = record.path; this.cwd = record.item.cwd || this.cwd; this.planPhase = "idle"; this.persist();
        await this.refreshCatalog(); this.emit(await this.snapshot());
      }
      return result;
    } finally {
      this.rpcStatus = "ready";
      this.emit({ type: "session_switching", sessionId: null }); this.emitHostState();
    }
  }

  private async newSession(requestedCwd?: string): Promise<{ cancelled: boolean }> {
    this.assertCanSwitch();
    const targetCwd = requestedCwd || this.cwd;
    const allowedCwds = new Set(this.catalog.map((record) => record.item.cwd).filter(Boolean));
    allowedCwds.add(this.cwd);
    if (!allowedCwds.has(targetCwd) || !existsSync(targetCwd)) throw new Error("New sessions are limited to known project directories.");
    this.rpcStatus = "switching"; this.emit({ type: "session_switching", sessionId: null }); this.emitHostState();
    try {
      let result = { cancelled: false };
      if (targetCwd === this.cwd) result = await this.requireRpc().newSession();
      else {
        await this.rpc?.stop(); this.rpc = null; this.activePath = null;
        await this.startRpc(targetCwd);
      }
      const state = await this.requireRpc().getState();
      this.activePath = state.sessionFile || null; this.cwd = targetCwd; this.planPhase = "idle"; this.persist();
      await this.refreshCatalog(); this.emit(await this.snapshot());
      return result;
    } finally {
      this.rpcStatus = "ready"; this.emit({ type: "session_switching", sessionId: null }); this.emitHostState();
    }
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
    const [state, entries, models] = await Promise.all([rpc.getState(), rpc.getEntries(), rpc.getAvailableModels()]);
    let contextUsage: unknown = null;
    try { contextUsage = (await rpc.getSessionStats()).contextUsage ?? null; } catch {}
    this.activePath = state.sessionFile || this.activePath;
    return {
      type: "snapshot", version: 2, sessionFile: state.sessionFile || null, sessionName: state.sessionName || null,
      cwd: this.activeRecord()?.item.cwd || this.cwd, entries: entries.entries, model: (state.model as any) || null,
      availableModels: models as any[], thinkingLevel: state.thinkingLevel, isRunning: state.isStreaming,
      contextUsage, planPhase: this.planPhase,
    };
  }

  private async checkRpcHealth(): Promise<void> {
    if (this.recovering || this.rpcStatus !== "ready" || !this.rpc) return;
    try {
      await this.rpc.getState();
    } catch {
      this.recovering = true;
      this.rpcStatus = "error"; this.emitHostState();
      try {
        await this.rpc?.stop();
        this.rpc = null;
        await this.startRpc(this.cwd, this.activePath && existsSync(this.activePath) ? this.activePath : undefined);
        await this.refreshCatalog();
        this.emit(await this.snapshot());
      } catch (error) {
        this.emit({ type: "host_state", rpcStatus: "error", activeReviewId: this.review.active?.id ?? null, error: error instanceof Error ? error.message : String(error) });
      } finally {
        this.recovering = false;
      }
    }
  }

  private async refreshCatalog(): Promise<void> {
    const sessions = await SessionManager.listAll();
    this.catalog = buildSessionCatalog(sessions, this.activePath, { running: this.running, reviewing: Boolean(this.review.active) });
    this.emit(this.catalogMessage());
  }

  private catalogMessage(): ServerMessage {
    return { type: "session_catalog", sessions: this.catalog.map((record) => record.item), activeSessionId: this.activeRecord()?.item.id ?? null };
  }

  private activeRecord(): CatalogRecord | undefined { return this.catalog.find((record) => record.path === this.activePath); }
  private hostState(): ServerMessage { return { type: "host_state", rpcStatus: this.rpcStatus, activeReviewId: this.review.active?.id ?? null }; }
  private emitHostState(): void { this.emit(this.hostState()); }
  private emit(message: ServerMessage): void { for (const listener of this.listeners) listener(message); }
  private requireRpc(): RpcClient { if (!this.rpc || this.rpcStatus === "error" || this.rpcStatus === "stopped") throw new Error("Pi RPC runtime is unavailable."); return this.rpc; }
  private assertCanSwitch(): void {
    assertSessionSwitchAllowed({ running: this.running, reviewing: Boolean(this.review.active) });
  }
  private persist(): void {
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(statePath, JSON.stringify({ cwd: this.cwd, sessionPath: this.activePath }, null, 2));
  }
}

function readHostState(): { cwd?: string; sessionPath?: string } {
  try { return JSON.parse(readFileSync(statePath, "utf8")); } catch { return {}; }
}
