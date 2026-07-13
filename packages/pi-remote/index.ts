import { timingSafeEqual, randomUUID } from "node:crypto";
import { createServer, type Server as HttpServer } from "node:http";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  PROTOCOL_VERSION,
  clientMessageSchema,
  serverMessageSchema,
  type ClientCommand,
  type ServerMessage,
} from "@pi-remote/protocol";
import { WebSocket, WebSocketServer } from "ws";
import { codeReviewFollowUp, routePlanReviewEvent } from "./review-routing.ts";
import { createTokenStore } from "./token-store.ts";

const PORT = readPort("PI_REMOTE_PORT", 31415);
const HOST = process.env.PI_REMOTE_HOST || "0.0.0.0";
const PLANNOTATOR_PORT = readPort("PLANNOTATOR_PORT", 19432);
const PLANNOTATOR_REQUEST = "plannotator:request";
const AUTH_TIMEOUT_MS = 5_000;

function readPort(name: string, fallback: number): number {
  const value = Number(process.env[name] || fallback);
  return Number.isInteger(value) && value > 0 && value < 65536 ? value : fallback;
}

export function tokensEqual(expectedToken: string, candidate: string): boolean {
  const expected = Buffer.from(expectedToken);
  const actual = Buffer.from(candidate);
  return expected.length > 0 && expected.length === actual.length && timingSafeEqual(expected, actual);
}

export default function piRemote(pi: ExtensionAPI): void {
  const tokenStore = createTokenStore();
  let token = tokenStore.get();
  const tokenMatches = (candidate: string): boolean => tokensEqual(token, candidate);
  let latestCtx: ExtensionContext | null = null;
  let server: HttpServer | null = null;
  let wss: WebSocketServer | null = null;
  let planPhase: "idle" | "planning" | "executing" | "reviewing" = "idle";
  const clients = new Map<WebSocket, { authenticated: boolean; timer: NodeJS.Timeout }>();
  const activePlanReviews = new Map<string, string>();
  let activeCodeReview: string | null = null;

  pi.registerCommand("pi-remote", {
    description: "Open Pi Remote settings",
    handler: async (_args, ctx) => {
      const choice = await ctx.ui.select("Pi Remote settings", ["Generate new token", "Display token"]);
      if (choice === "Generate new token") {
        token = tokenStore.rotate();
        for (const client of clients.keys()) client.close(4004, "Pi Remote token regenerated");
        ctx.ui.notify(`New Pi Remote token: ${token}`, "info");
      } else if (choice === "Display token") {
        ctx.ui.notify(`Pi Remote token: ${token}`, "info");
      }
    },
  });

  function reviewUrl(): string {
    return process.env.PLANNOTATOR_PUBLIC_URL || `http://localhost:${PLANNOTATOR_PORT}`;
  }

  function send(ws: WebSocket, message: ServerMessage): void {
    const validated = serverMessageSchema.parse(message);
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(validated));
  }

  function broadcast(message: ServerMessage): void {
    for (const [client, state] of clients) {
      if (state.authenticated) send(client, message);
    }
  }

  function respond(ws: WebSocket, command: ClientCommand, success: boolean, data?: unknown, error?: string): void {
    send(ws, {
      type: "response",
      id: command.id,
      command: command.type,
      success,
      ...(data === undefined ? {} : { data }),
      ...(error ? { error } : {}),
    });
  }

  async function snapshot(ctx: ExtensionContext): Promise<ServerMessage> {
    let availableModels: unknown[] = [];
    try {
      availableModels = await ctx.modelRegistry.getAvailable();
    } catch {
      // A model registry can be temporarily unavailable during startup.
    }
    return {
      type: "snapshot",
      version: PROTOCOL_VERSION,
      sessionFile: ctx.sessionManager.getSessionFile() || null,
      sessionName: pi.getSessionName() || null,
      cwd: ctx.cwd,
      entries: [...ctx.sessionManager.getEntries()],
      model: ctx.model ? (ctx.model as never) : null,
      availableModels: availableModels as never[],
      thinkingLevel: pi.getThinkingLevel(),
      isRunning: !ctx.isIdle(),
      contextUsage: ctx.getContextUsage() || null,
      planPhase,
    };
  }

  function requestPlannotator(action: string, payload: Record<string, unknown>, onResponse: (response: any) => void): void {
    let settled = false;
    const requestId = randomUUID();
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      onResponse({ status: "unavailable", error: "Plannotator did not respond. Is @plannotator/pi-extension installed?" });
    }, action === "code-review" ? 24 * 60 * 60 * 1000 : AUTH_TIMEOUT_MS);
    pi.events.emit(PLANNOTATOR_REQUEST, {
      requestId,
      action,
      payload,
      respond(response: unknown) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        onResponse(response);
      },
    });
  }

  function startCodeReview(ws: WebSocket, command: Extract<ClientCommand, { type: "start_code_review" }>): void {
    if (activeCodeReview) {
      respond(ws, command, false, undefined, "A code review is already active.");
      return;
    }
    const ctx = latestCtx;
    if (!ctx) {
      respond(ws, command, false, undefined, "Pi session is not ready.");
      return;
    }
    // Probe the shared API first so a missing Plannotator install fails in five seconds
    // instead of leaving a phantom review open indefinitely.
    requestPlannotator("plan-mode", { mode: "status" }, (availability) => {
      if (availability?.status !== "handled") {
        respond(ws, command, false, undefined, availability?.error || "Plannotator is unavailable.");
        return;
      }
      const reviewId = randomUUID();
      activeCodeReview = reviewId;
      broadcast({ type: "review_started", reviewId, kind: "code", url: reviewUrl() });
      respond(ws, command, true, { reviewId });
      requestPlannotator(
        "code-review",
        { cwd: ctx.cwd, diffType: command.diffType, defaultBranch: command.defaultBranch },
        (response) => {
          activeCodeReview = null;
          const result = response?.status === "handled" ? response.result : null;
          if (!result) {
            broadcast({ type: "review_finished", reviewId, kind: "code", error: response?.error || "Code review failed to start." });
            return;
          }
          const followUp = codeReviewFollowUp(result);
          if (followUp) pi.sendUserMessage(followUp, { deliverAs: "followUp" });
          broadcast({ type: "review_finished", reviewId, kind: "code", approved: Boolean(result.approved) });
        },
      );
    });
  }

  async function handleCommand(ws: WebSocket, command: ClientCommand): Promise<void> {
    const ctx = latestCtx;
    if (!ctx) {
      respond(ws, command, false, undefined, "Pi session is not ready.");
      return;
    }
    try {
      switch (command.type) {
        case "prompt":
          pi.sendUserMessage(command.message, ctx.isIdle() ? undefined : { deliverAs: "steer" });
          respond(ws, command, true);
          break;
        case "steer":
          pi.sendUserMessage(command.message, { deliverAs: "steer" });
          respond(ws, command, true);
          break;
        case "follow_up":
          pi.sendUserMessage(command.message, { deliverAs: "followUp" });
          respond(ws, command, true);
          break;
        case "abort":
          ctx.abort();
          respond(ws, command, true);
          break;
        case "set_model": {
          const models = await ctx.modelRegistry.getAvailable();
          const model = models.find((item) => item.provider === command.provider && item.id === command.modelId);
          if (!model) throw new Error(`Model not found: ${command.provider}/${command.modelId}`);
          if (!(await pi.setModel(model))) throw new Error("No credentials are available for that model.");
          respond(ws, command, true, model);
          break;
        }
        case "set_thinking":
          pi.setThinkingLevel(command.level);
          respond(ws, command, true, { level: pi.getThinkingLevel() });
          break;
        case "compact":
          ctx.compact({
            customInstructions: command.customInstructions,
            onError: (error) => broadcast({ type: "error", code: "compaction_failed", message: error.message }),
          });
          respond(ws, command, true);
          break;
        case "set_plan_mode":
          requestPlannotator("plan-mode", { mode: command.mode }, (response) => {
            if (response?.status === "handled") {
              planPhase = response.result.phase;
              respond(ws, command, true, response.result);
              broadcast({ type: "event", event: { type: "plan_phase", phase: planPhase } });
            } else {
              respond(ws, command, false, undefined, response?.error || "Plan mode is unavailable.");
            }
          });
          break;
        case "start_code_review":
          startCodeReview(ws, command);
          break;
      }
    } catch (error) {
      respond(ws, command, false, undefined, error instanceof Error ? error.message : String(error));
    }
  }

  function startServer(): void {
    if (server) return;
    server = createServer((req, res) => {
      if (req.url !== "/health") {
        res.writeHead(404).end();
        return;
      }
      const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, "") || "";
      if (!tokenMatches(bearer)) {
        res.writeHead(401, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true, version: PROTOCOL_VERSION }));
    });
    wss = new WebSocketServer({ server });
    wss.on("connection", (ws) => {
      const timer = setTimeout(() => ws.close(4001, "Authentication timeout"), AUTH_TIMEOUT_MS);
      clients.set(ws, { authenticated: false, timer });
      ws.on("message", async (bytes) => {
        let raw: unknown;
        try {
          raw = JSON.parse(bytes.toString());
        } catch {
          send(ws, { type: "error", code: "invalid_json", message: "Message is not valid JSON." });
          return;
        }
        const parsed = clientMessageSchema.safeParse(raw);
        if (!parsed.success) {
          send(ws, { type: "error", code: "invalid_message", message: parsed.error.issues[0]?.message || "Invalid message." });
          return;
        }
        const state = clients.get(ws);
        if (!state) return;
        if (!state.authenticated) {
          if (parsed.data.type !== "auth" || !tokenMatches(parsed.data.token)) {
            send(ws, { type: "error", code: "unauthorized", message: "Authentication failed." });
            ws.close(4003, "Unauthorized");
            return;
          }
          state.authenticated = true;
          clearTimeout(state.timer);
          if (latestCtx) send(ws, await snapshot(latestCtx));
          return;
        }
        if (parsed.data.type === "auth") {
          send(ws, { type: "error", code: "already_authenticated", message: "Already authenticated." });
          return;
        }
        await handleCommand(ws, parsed.data);
      });
      ws.on("close", () => {
        const state = clients.get(ws);
        if (state) clearTimeout(state.timer);
        clients.delete(ws);
      });
    });
    server.on("error", (error) => console.error(`[pi-remote] ${error.message}`));
    server.listen(PORT, HOST, () => console.log(`[pi-remote] listening on ws://${HOST}:${PORT}`));
  }

  function stopServer(): void {
    for (const [client, state] of clients) {
      clearTimeout(state.timer);
      client.close(1001, "Pi shutting down");
    }
    clients.clear();
    wss?.close();
    server?.close();
    wss = null;
    server = null;
  }

  const forwardedEvents = [
    "agent_start", "agent_end", "turn_start", "turn_end", "message_start", "message_update", "message_end",
    "tool_execution_start", "tool_execution_update", "tool_execution_end", "model_select", "thinking_level_select",
    "session_before_compact", "session_compact",
  ] as const;
  for (const eventName of forwardedEvents) {
    (pi.on as any)(eventName, (event: any, ctx: ExtensionContext) => {
      latestCtx = ctx;
      broadcast({ type: "event", event: { ...event, type: eventName } });
      const reviewRoute = routePlanReviewEvent({ ...event, type: eventName }, activePlanReviews, reviewUrl());
      if (reviewRoute) {
        planPhase = reviewRoute.phase;
        broadcast(reviewRoute.message);
      }
    });
  }

  pi.on("session_start", (_event, ctx) => {
    latestCtx = ctx;
    startServer();
    requestPlannotator("plan-mode", { mode: "status" }, (response) => {
      if (response?.status === "handled") planPhase = response.result.phase;
    });
  });
  pi.on("session_info_changed", (_event, ctx) => {
    latestCtx = ctx;
    void snapshot(ctx).then(broadcast);
  });
  pi.on("session_shutdown", () => {
    latestCtx = null;
    stopServer();
  });
}
