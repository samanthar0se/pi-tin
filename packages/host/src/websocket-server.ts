import { createServer, type Server as HttpServer } from "node:http";
import { PROTOCOL_VERSION, clientMessageSchema, serverMessageSchema, type ServerMessage } from "@pi-tin/protocol";
import { WebSocket, WebSocketServer } from "ws";
import { BUILD_REVISION } from "./build-info.ts";
import type { HostBackend } from "./types.ts";

const INITIAL_SYNC_TIMEOUT_MS = 30_000;
const MAX_INITIAL_SYNC_QUEUE = 512;

export class HostWebSocketServer {
  private http: HttpServer | null = null;
  private wss: WebSocketServer | null = null;
  private clients = new Map<WebSocket, {
    authenticated: boolean;
    syncing: boolean;
    queued: ServerMessage[];
    timer: NodeJS.Timeout;
  }>();
  private unsubscribe: (() => void) | null = null;

  constructor(private backend: HostBackend, private host: string, private port: number) {}

  async start(): Promise<void> {
    if (this.http) return;
    this.http = createServer((req, res) => {
      if (req.url !== "/health") { res.writeHead(404).end(); return; }
      const token = req.headers.authorization?.replace(/^Bearer\s+/i, "") || "";
      if (!this.backend.authenticate(token)) {
        res.writeHead(401, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify({
        ok: true, version: PROTOCOL_VERSION, revision: BUILD_REVISION,
      }));
    });
    this.wss = new WebSocketServer({ server: this.http });
    this.wss.on("connection", (socket) => this.accept(socket));
    this.unsubscribe = this.backend.subscribe((message) => this.broadcast(message));
    await new Promise<void>((resolve, reject) => {
      this.http!.once("error", reject);
      this.http!.listen(this.port, this.host, () => resolve());
    });
  }

  disconnectAuthenticated(reason = "Authentication changed"): void {
    for (const [socket, state] of this.clients) if (state.authenticated) socket.close(4004, reason);
  }

  async stop(): Promise<void> {
    this.unsubscribe?.(); this.unsubscribe = null;
    for (const [socket, state] of this.clients) { clearTimeout(state.timer); socket.close(1001, "Host stopping"); }
    this.clients.clear();
    this.wss?.close();
    await new Promise<void>((resolve) => this.http?.close(() => resolve()) ?? resolve());
    this.wss = null; this.http = null;
  }

  private accept(socket: WebSocket): void {
    const timer = setTimeout(() => socket.close(4001, "Authentication timeout"), 5_000);
    this.clients.set(socket, { authenticated: false, syncing: false, queued: [], timer });
    socket.on("message", async (bytes) => {
      let raw: any;
      try { raw = JSON.parse(bytes.toString()); }
      catch { this.send(socket, { type: "error", code: "invalid_json", message: "Message is not valid JSON." }); return; }
      const state = this.clients.get(socket);
      if (!state) return;
      if (!state.authenticated && raw?.type === "auth" && raw.version !== PROTOCOL_VERSION) {
        this.send(socket, { type: "error", code: "protocol_mismatch", message: `Host requires protocol v${PROTOCOL_VERSION}. Update Pi Tin.` });
        socket.close(4002, "Protocol mismatch"); return;
      }
      const parsed = clientMessageSchema.safeParse(raw);
      if (!parsed.success) {
        this.send(socket, { type: "error", code: "invalid_message", message: parsed.error.issues[0]?.message || "Invalid message." }); return;
      }
      if (!state.authenticated) {
        if (parsed.data.type !== "auth" || !this.backend.authenticate(parsed.data.token)) {
          this.send(socket, { type: "error", code: "unauthorized", message: "Authentication failed." });
          socket.close(4003, "Unauthorized"); return;
        }
        state.authenticated = true;
        state.syncing = true;
        clearTimeout(state.timer);
        let synced = false;
        try {
          const messages = await withTimeout(this.backend.initialMessages(), INITIAL_SYNC_TIMEOUT_MS);
          if (!state.authenticated || socket.readyState !== WebSocket.OPEN) return;
          for (const message of messages) this.send(socket, message);
          synced = true;
        } catch (error) {
          state.authenticated = false;
          this.send(socket, {
            type: "error",
            code: "initial_sync_failed",
            message: error instanceof Error ? error.message : "Could not synchronize with the Pi host.",
          });
          socket.close(1011, "Initial synchronization failed");
        } finally {
          state.syncing = false;
          if (synced) for (const message of state.queued) this.send(socket, message);
          state.queued = [];
        }
        return;
      }
      if (parsed.data.type === "auth") return;
      try {
        const result = await this.backend.handle(parsed.data);
        this.send(socket, {
          type: "response", id: parsed.data.id, command: parsed.data.type,
          ...("sessionId" in parsed.data ? { sessionId: parsed.data.sessionId } : {}), success: true, ...result,
        });
      } catch (error) {
        this.send(socket, {
          type: "response", id: parsed.data.id, command: parsed.data.type,
          ...("sessionId" in parsed.data ? { sessionId: parsed.data.sessionId } : {}), success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
    socket.on("close", () => { const state = this.clients.get(socket); if (state) clearTimeout(state.timer); this.clients.delete(socket); });
  }

  private send(socket: WebSocket, message: ServerMessage): void {
    const valid = serverMessageSchema.parse(message);
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(valid));
  }

  private broadcast(message: ServerMessage): void {
    for (const [socket, state] of this.clients) {
      if (!state.authenticated) continue;
      if (state.syncing && state.queued.length >= MAX_INITIAL_SYNC_QUEUE) {
        state.authenticated = false;
        state.syncing = false;
        state.queued = [];
        socket.close(1013, "Initial synchronization overloaded");
      } else if (state.syncing) state.queued.push(message);
      else this.send(socket, message);
    }
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Initial host synchronization timed out.")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
