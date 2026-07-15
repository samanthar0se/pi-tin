import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RpcClient, type RpcExtensionUIResponse } from "@earendil-works/pi-coding-agent";
import {
  PROTOCOL_VERSION,
  type ClientCommand,
  type ExtensionUiRequest,
  type ServerMessage,
  type SessionDescriptor,
  type Snapshot,
} from "@pi-tin/protocol";
import { createTokenStore } from "../../pi-tin/token-store.ts";
import { ReviewTracker } from "./plannotator.ts";
import type { HostBackend } from "./types.ts";

const PLAN_TOOL = "plannotator_submit_plan";
const MAX_SESSIONS = 5;
const agentDir = process.env.PI_CODING_AGENT_DIR || resolve(homedir(), ".pi", "agent");
const statePath = resolve(agentDir, "pi-tin-host.json");
const legacyStatePath = resolve(agentDir, "pi-remote-host.json");
const defaultCwd = process.env.PI_TIN_CWD || process.env.PI_REMOTE_CWD || process.cwd();

type RpcStatus = "starting" | "ready" | "error" | "stopped";
type PersistedSession = { id: string; cwd: string; sessionPath?: string | null };
type SessionCommand = Exclude<ClientCommand, { type: "create_session" | "close_session" }>;
type HostStateLoadResult =
  | { status: "valid"; sessions: PersistedSession[]; warnings: string[]; invalidPaths: string[] }
  | { status: "missing"; warnings: []; invalidPaths: [] }
  | { status: "invalid"; warnings: string[]; invalidPaths: string[] };

export class HostController implements HostBackend {
  private listeners = new Set<(message: ServerMessage) => void>();
  private sessions = new Map<string, PiSessionRuntime>();
  private persistenceEnabled = true;
  readonly tokenStore = createTokenStore();
  readonly review: ReviewTracker;

  constructor(private readonly rpcCliPath?: string) {
    const port = Number(process.env.PLANNOTATOR_PORT || 19432);
    this.review = new ReviewTracker(`http://localhost:${port}`, (message) => {
      this.emit(message);
      this.sessions.get(message.sessionId)?.emitHostState();
      this.emitSessionList();
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
    for (const warning of saved.warnings) console.warn(`[pi-tin] ${warning}`);
    this.persistenceEnabled = preserveInvalidStateFiles(saved.invalidPaths);
    if (!this.persistenceEnabled) console.warn("[pi-tin] Host state persistence is disabled to avoid overwriting an invalid file that could not be backed up.");
    const records = saved.status === "valid"
      ? saved.sessions.slice(0, MAX_SESSIONS)
      : [{ id: randomUUID(), cwd: normalizeCwd(defaultCwd) }];
    for (const record of records) {
      if (this.sessions.has(record.id)) continue;
      this.sessions.set(record.id, this.createRuntime(record));
    }
    await Promise.allSettled([...this.sessions.values()].map((session) => session.start()));
    this.persist();
  }

  async stop(): Promise<void> {
    this.review.dispose();
    await Promise.allSettled([...this.sessions.values()].map((session) => session.stop()));
  }

  async initialMessages(): Promise<ServerMessage[]> {
    const messages: ServerMessage[] = [this.sessionList()];
    for (const session of this.sessions.values()) messages.push(...await session.initialMessages());
    return messages;
  }

  async handle(command: ClientCommand): Promise<{ data?: unknown }> {
    if (command.type === "create_session") return { data: await this.createSession(command.cwd) };
    if (command.type === "close_session") return { data: await this.closeSession(command.sessionId) };
    const session = this.sessions.get(command.sessionId);
    if (!session) throw new Error("This Pi session is no longer open.");
    return session.handle(command);
  }

  private async createSession(cwdInput: string): Promise<{ sessionId: string }> {
    const cwd = normalizeCwd(cwdInput);
    const existing = [...this.sessions.values()].find((session) => sameCwd(session.cwd, cwd));
    if (existing) {
      if (existing.isClosing()) throw new Error("This workspace is still closing. Try again in a moment.");
      return { sessionId: existing.id };
    }
    if (this.sessions.size >= MAX_SESSIONS) throw new Error(`Pi Tin supports up to ${MAX_SESSIONS} open sessions.`);
    const record = { id: randomUUID(), cwd };
    const session = this.createRuntime(record);
    this.sessions.set(record.id, session);
    this.persist();
    this.emitSessionList();
    void session.start().then(
      () => this.emitSessionList(),
      () => {
        this.persist();
        this.emitSessionList();
      },
    );
    return { sessionId: record.id };
  }

  private async closeSession(sessionId: string): Promise<{ sessionId: string }> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("This Pi session is no longer open.");
    await session.close();
    this.sessions.delete(sessionId);
    this.persist();
    this.emitSessionList();
    return { sessionId };
  }

  private createRuntime(record: PersistedSession): PiSessionRuntime {
    return new PiSessionRuntime(
      record.id,
      record.cwd,
      record.sessionPath || null,
      this.rpcCliPath,
      this.review,
      (message) => this.emit(message),
      () => { this.persist(); this.emitSessionList(); },
    );
  }

  private sessionList(): ServerMessage {
    return {
      type: "session_list",
      version: PROTOCOL_VERSION,
      sessions: [...this.sessions.values()].map((session) => session.descriptor()),
      maxSessions: MAX_SESSIONS,
    };
  }

  private emitSessionList(): void { this.emit(this.sessionList()); }
  private emit(message: ServerMessage): void { for (const listener of this.listeners) listener(message); }

  private persist(): void {
    if (!this.persistenceEnabled) return;
    mkdirSync(dirname(statePath), { recursive: true });
    const sessions = [...this.sessions.values()].map((session) => session.persisted());
    writeFileSync(statePath, JSON.stringify({ version: 2, sessions }, null, 2));
  }
}

class PiSessionRuntime {
  private rpc: RpcClient | null = null;
  private activePath: string | null;
  private sessionName: string | null = null;
  private running = false;
  private rpcStatus: RpcStatus = "stopped";
  private planPhase: Snapshot["planPhase"] = "idle";
  private healthTimer: NodeJS.Timeout | null = null;
  private healthCheckPending = false;
  private recovering = false;
  private restartPending = false;
  private closing = false;
  private closed = false;
  private lifecycle: Promise<void> = Promise.resolve();
  private pendingUiRequest: ExtensionUiRequest | null = null;

  constructor(
    readonly id: string,
    readonly cwd: string,
    sessionPath: string | null,
    private readonly rpcCliPath: string | undefined,
    private review: ReviewTracker,
    private emit: (message: ServerMessage) => void,
    private persistAll: () => void,
  ) {
    this.activePath = sessionPath;
  }

  async start(): Promise<void> {
    await this.serializeLifecycle(async () => {
      await this.startRpc(this.cwd, this.activePath && existsSync(this.activePath) ? this.activePath : undefined);
      this.emit(await this.snapshot());
    });
  }

  async stop(): Promise<void> {
    await this.serializeLifecycle(() => this.stopNow());
  }

  async close(): Promise<void> {
    if (this.closing || this.closed) throw new Error("This Pi session is already closing.");
    this.closing = true;
    try {
      await this.serializeLifecycle(async () => {
        this.assertClosable();
        await this.stopNow();
        this.closed = true;
      });
    } finally {
      this.closing = false;
    }
  }

  private async stopNow(): Promise<void> {
    if (this.healthTimer) clearInterval(this.healthTimer);
    this.healthTimer = null;
    this.rpcStatus = "stopped";
    this.running = false;
    this.pendingUiRequest = null;
    this.emitHostState();
    const rpc = this.rpc;
    this.rpc = null;
    await rpc?.stop();
  }

  async initialMessages(): Promise<ServerMessage[]> {
    const messages: ServerMessage[] = [this.hostState()];
    if (this.rpcStatus === "ready") {
      try { messages.push(await this.snapshot()); } catch {}
    }
    if (this.pendingUiRequest) messages.push(this.pendingUiRequest);
    const activeReview = this.review.currentStartMessage(this.id);
    if (activeReview) messages.push(activeReview);
    return messages;
  }

  async handle(command: SessionCommand): Promise<{ data?: unknown }> {
    if (this.closing || this.closed) throw new Error("This Pi session is closing.");
    if (command.type === "restart_pi") return { data: await this.restartRpc() };
    if (command.type === "new_session") return { data: await this.newSession() };
    if (command.type === "extension_ui_response") { await this.respondToExtensionUi(command); return {}; }
    const rpc = this.requireRpc();
    switch (command.type) {
      case "prompt": await rpc.prompt(command.message, command.images); return {};
      case "steer": await rpc.steer(command.message, command.images); return {};
      case "follow_up": await rpc.followUp(command.message, command.images); return {};
      case "abort": await rpc.abort(); return {};
      case "set_model": return { data: await rpc.setModel(command.provider, command.modelId) };
      case "set_thinking": await rpc.setThinkingLevel(command.level as any); return { data: { level: command.level } };
      case "compact": return { data: await rpc.compact(command.customInstructions) };
      case "set_plan_mode": return { data: await this.setPlanMode(command.mode) };
      case "start_code_review": return { data: await this.startCodeReview() };
    }
  }

  descriptor(): SessionDescriptor {
    return {
      sessionId: this.id,
      sessionFile: this.activePath,
      sessionName: this.sessionName,
      cwd: this.cwd,
      rpcStatus: this.rpcStatus,
      isRunning: this.running,
      activeReviewId: this.review.active?.sessionId === this.id ? this.review.active.id : null,
    };
  }

  persisted(): PersistedSession { return { id: this.id, cwd: this.cwd, sessionPath: this.activePath }; }

  isClosing(): boolean { return this.closing || this.closed; }

  private assertClosable(): void {
    if (this.running) throw new Error("Stop Pi before closing this session.");
    if (this.review.active?.sessionId === this.id) throw new Error("Finish the active review before closing this session.");
  }

  emitHostState(): void { this.emit(this.hostState()); }

  private async newSession(): Promise<{ cancelled: boolean; sessionFile: string | null }> {
    if (this.running) throw new Error("Stop Pi before starting a new session.");
    if (this.review.active?.sessionId === this.id) throw new Error("Finish the active review before starting a new session.");
    const result = await this.requireRpc().newSession();
    if (result.cancelled) return { cancelled: true, sessionFile: this.activePath };
    this.running = false;
    this.planPhase = "idle";
    const state = await this.requireRpc().getState();
    this.activePath = state.sessionFile || null;
    this.sessionName = state.sessionName || null;
    this.persistAll();
    this.emitHostState();
    this.emit(await this.snapshot());
    return { cancelled: false, sessionFile: this.activePath };
  }

  private async restartRpc(): Promise<{ sessionFile: string | null }> {
    if (this.rpcStatus === "starting" || this.recovering || this.restartPending) throw new Error("Pi is already restarting.");
    this.restartPending = true;
    try {
      return await this.serializeLifecycle(async () => {
        if (this.review.active?.sessionId === this.id) throw new Error("Finish the active review before restarting Pi.");
        const rpc = this.rpc;
        if (rpc) {
          try {
            const state = await rpc.getState();
            this.activePath = state.sessionFile || this.activePath;
            this.sessionName = state.sessionName || null;
            this.persistAll();
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
      });
    } finally {
      this.restartPending = false;
    }
  }

  private async startRpc(cwd: string, sessionPath?: string): Promise<void> {
    this.rpcStatus = "starting";
    this.emitHostState();
    let rpc: RpcClient | null = null;
    try {
      rpc = new RpcClient({ cliPath: this.rpcCliPath ?? defaultRpcCliPath(), cwd, args: sessionPath ? ["--session", sessionPath] : [], env: { PLANNOTATOR_REMOTE: "1" } });
      rpc.onEvent((event) => this.onRpcEvent(event as any));
      await rpc.start();
      this.rpc = rpc;
      this.rpcStatus = "ready";
      const state = await rpc.getState();
      this.activePath = state.sessionFile || null;
      this.sessionName = state.sessionName || null;
      this.running = state.isStreaming;
      this.persistAll();
      this.ensureHealthMonitoring();
      this.emitHostState();
    } catch (error) {
      if (rpc) try { await rpc.stop(); } catch {}
      this.rpc = null;
      this.running = false;
      this.rpcStatus = "error";
      this.emit({
        type: "host_state",
        sessionId: this.id,
        rpcStatus: "error",
        activeReviewId: this.review.active?.sessionId === this.id ? this.review.active.id : null,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private onRpcEvent(event: any): void {
    if (event.type === "extension_ui_request") {
      const request = { ...event, sessionId: this.id } as ExtensionUiRequest;
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
      this.review.start(this.id, "plan", String(event.toolCallId));
    }
    if (event.type === "tool_execution_start" && event.toolName === PLAN_TOOL && this.review.active?.sessionId !== this.id) {
      this.emit({ type: "error", sessionId: this.id, code: "review_busy", message: "Another Pi session is already using Plannotator." });
    }
    if (event.type === "tool_execution_end" && event.toolName === PLAN_TOOL) {
      const approved = Boolean(event.result?.details?.approved);
      this.planPhase = approved ? "executing" : "planning";
      this.review.finish(this.id, { approved, ...(event.isError ? { error: "Plan review failed." } : {}) });
    }
    if (event.type === "session_info_changed" || event.type === "agent_settled") void this.captureSessionPath();
    this.emit({ type: "event", sessionId: this.id, event });
    if (event.type === "agent_settled" || event.type === "compaction_end" || event.type === "model_select") void this.emitContextUsage();
    this.emitHostState();
  }

  private async respondToExtensionUi(command: Extract<SessionCommand, { type: "extension_ui_response" }>): Promise<void> {
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
      this.emit({ type: "event", sessionId: this.id, event: { type: "context_usage", contextUsage } });
    } catch {}
  }

  private async captureSessionPath(): Promise<void> {
    try {
      const state = await this.requireRpc().getState();
      this.activePath = state.sessionFile || this.activePath;
      this.sessionName = state.sessionName || null;
      this.persistAll();
    } catch {}
  }

  private async setPlanMode(mode: "enter" | "exit" | "toggle" | "status"): Promise<{ phase: Snapshot["planPhase"] }> {
    if (mode === "status") return { phase: this.planPhase };
    if (this.review.active && this.review.active.sessionId !== this.id) throw new Error("Another Pi session is already using Plannotator.");
    const shouldToggle = mode === "toggle" || (mode === "enter" && this.planPhase === "idle") || (mode === "exit" && this.planPhase !== "idle");
    if (shouldToggle) {
      await this.requireRpc().prompt("/plannotator");
      this.planPhase = this.planPhase === "idle" ? "planning" : "idle";
      this.emit({ type: "event", sessionId: this.id, event: { type: "plan_phase", phase: this.planPhase } });
    }
    return { phase: this.planPhase };
  }

  private async startCodeReview(): Promise<{ reviewId: string }> {
    if (this.running) throw new Error("Wait for Pi to finish before starting code review.");
    const id = this.review.start(this.id, "code");
    try {
      await this.requireRpc().prompt("/plannotator-review");
      void this.review.watchCodeReview(this.id, Number(process.env.PLANNOTATOR_PORT || 19432));
      return { reviewId: id };
    } catch (error) {
      this.review.finish(this.id, { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  private async snapshot(): Promise<Snapshot> {
    const rpc = this.requireRpc();
    const [state, entries, models, commands] = await Promise.all([rpc.getState(), rpc.getEntries(), rpc.getAvailableModels(), rpc.getCommands()]);
    let contextUsage: Snapshot["contextUsage"] = null;
    try { contextUsage = ((await rpc.getSessionStats()).contextUsage as Snapshot["contextUsage"]) ?? null; } catch {}
    this.activePath = state.sessionFile || this.activePath;
    this.sessionName = state.sessionName || null;
    this.persistAll();
    return {
      type: "snapshot",
      version: PROTOCOL_VERSION,
      sessionId: this.id,
      sessionFile: state.sessionFile || null,
      sessionName: state.sessionName || null,
      cwd: this.cwd,
      entries: entries.entries,
      model: (state.model as any) || null,
      availableModels: models as any[],
      commands: commands.map((command) => ({ name: command.name, description: command.description, source: command.source, scope: command.sourceInfo.scope })),
      thinkingLevel: state.thinkingLevel,
      isRunning: state.isStreaming,
      contextUsage,
      planPhase: this.planPhase,
    };
  }

  private async checkRpcHealth(): Promise<void> {
    await this.serializeLifecycle(() => this.checkRpcHealthNow());
  }

  private async checkRpcHealthNow(): Promise<void> {
    if (this.recovering || this.rpcStatus !== "ready" || !this.rpc) return;
    try {
      await this.rpc.getState();
    } catch {
      this.recovering = true;
      this.rpcStatus = "error";
      this.running = false;
      this.pendingUiRequest = null;
      this.emitHostState();
      try {
        await this.rpc?.stop();
        this.rpc = null;
        await this.startRpc(this.cwd, this.activePath && existsSync(this.activePath) ? this.activePath : undefined);
        this.emit(await this.snapshot());
      } catch (error) {
        this.emit({
          type: "host_state",
          sessionId: this.id,
          rpcStatus: "error",
          activeReviewId: this.review.active?.sessionId === this.id ? this.review.active.id : null,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        this.recovering = false;
      }
    }
  }

  private ensureHealthMonitoring(): void {
    if (this.healthTimer) return;
    this.healthTimer = setInterval(() => {
      if (this.healthCheckPending) return;
      this.healthCheckPending = true;
      void this.checkRpcHealth().finally(() => { this.healthCheckPending = false; });
    }, 5_000);
  }

  private serializeLifecycle<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.lifecycle.then(operation, operation);
    this.lifecycle = result.then(() => undefined, () => undefined);
    return result;
  }

  private hostState(): ServerMessage {
    return {
      type: "host_state",
      sessionId: this.id,
      rpcStatus: this.rpcStatus,
      activeReviewId: this.review.active?.sessionId === this.id ? this.review.active.id : null,
    };
  }

  private requireRpc(): RpcClient {
    if (!this.rpc || this.rpcStatus === "error" || this.rpcStatus === "stopped") throw new Error("Pi RPC runtime is unavailable.");
    return this.rpc;
  }
}

function normalizeCwd(input: string): string {
  if (!isAbsolute(input)) throw new Error("Working directory must be an absolute path on the Pi host.");
  let path: string;
  try { path = realpathSync(input); } catch { throw new Error(`Working directory does not exist: ${input}`); }
  if (!statSync(path).isDirectory()) throw new Error(`Working directory is not a directory: ${input}`);
  return path;
}

function sameCwd(left: string, right: string): boolean {
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function readHostState(): HostStateLoadResult {
  const warnings: string[] = [];
  const invalidPaths = new Set<string>();
  let foundStateFile = false;
  for (const path of [statePath, legacyStatePath]) {
    if (!existsSync(path)) continue;
    foundStateFile = true;
    try {
      const value = JSON.parse(readFileSync(path, "utf8"));
      if (Array.isArray(value.sessions)) {
        const sessions = value.sessions.flatMap((session: any, index: number) => {
          if (!session?.id || !session?.cwd) {
            invalidPaths.add(path);
            warnings.push(`Ignored invalid session record ${index} in ${path}: id and cwd are required.`);
            return [];
          }
          try {
            return [{ id: String(session.id), cwd: normalizeCwd(String(session.cwd)), sessionPath: session.sessionPath ? String(session.sessionPath) : null }];
          } catch (error) {
            invalidPaths.add(path);
            warnings.push(`Ignored invalid session record ${index} in ${path}: ${errorMessage(error)}`);
            return [];
          }
        });
        if (value.sessions.length > 0 && sessions.length === 0) {
          warnings.push(`No valid session records were found in ${path}.`);
          continue;
        }
        return { status: "valid", sessions, warnings, invalidPaths: [...invalidPaths] };
      }
      if (value.cwd) {
        try {
          return {
            status: "valid",
            sessions: [{ id: randomUUID(), cwd: normalizeCwd(String(value.cwd)), sessionPath: value.sessionPath ? String(value.sessionPath) : null }],
            warnings,
            invalidPaths: [...invalidPaths],
          };
        } catch (error) {
          invalidPaths.add(path);
          warnings.push(`Could not load legacy host state from ${path}: ${errorMessage(error)}`);
          continue;
        }
      }
      invalidPaths.add(path);
      warnings.push(`Host state in ${path} does not contain a sessions array or legacy cwd.`);
    } catch (error) {
      invalidPaths.add(path);
      warnings.push(`Could not read host state from ${path}: ${errorMessage(error)}`);
    }
  }
  if (!foundStateFile) return { status: "missing", warnings: [], invalidPaths: [] };
  return {
    status: "invalid",
    warnings: [...warnings, "Saved host state was invalid; using the default session instead."],
    invalidPaths: [...invalidPaths],
  };
}

function preserveInvalidStateFiles(paths: string[]): boolean {
  let preserved = true;
  for (const path of paths) {
    try {
      const backupPath = `${path}.invalid-${Date.now()}-${randomUUID().slice(0, 8)}`;
      copyFileSync(path, backupPath);
      console.warn(`[pi-tin] Preserved invalid host state at ${backupPath}.`);
    } catch (error) {
      preserved = false;
      console.warn(`[pi-tin] Could not preserve invalid host state from ${path}: ${errorMessage(error)}`);
    }
  }
  return preserved;
}

function defaultRpcCliPath(): string {
  const rpcEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry"));
  return resolve(dirname(rpcEntry), "cli.js");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
