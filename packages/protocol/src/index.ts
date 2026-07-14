import { z } from "zod";

export const PROTOCOL_VERSION = 7 as const;
const requestId = z.string().min(1).max(128);
const sessionId = z.string().min(1).max(128);
const text = z.string().max(2_000_000);
const commandBase = { id: requestId } as const;
const sessionCommandBase = { ...commandBase, sessionId } as const;

export const authMessageSchema = z.object({
  type: z.literal("auth"), version: z.literal(PROTOCOL_VERSION), token: z.string().min(1).max(4096),
}).strict();

export const clientCommandSchema = z.discriminatedUnion("type", [
  z.object({ ...commandBase, type: z.literal("create_session"), cwd: z.string().min(1).max(32_768) }).strict(),
  z.object({ ...sessionCommandBase, type: z.literal("close_session") }).strict(),
  z.object({ ...sessionCommandBase, type: z.literal("prompt"), message: text }).strict(),
  z.object({ ...sessionCommandBase, type: z.literal("steer"), message: text }).strict(),
  z.object({ ...sessionCommandBase, type: z.literal("follow_up"), message: text }).strict(),
  z.object({ ...sessionCommandBase, type: z.literal("abort") }).strict(),
  z.object({ ...sessionCommandBase, type: z.literal("restart_pi") }).strict(),
  z.object({ ...sessionCommandBase, type: z.literal("new_session") }).strict(),
  z.object({ ...sessionCommandBase, type: z.literal("set_model"), provider: z.string().min(1), modelId: z.string().min(1) }).strict(),
  z.object({ ...sessionCommandBase, type: z.literal("set_thinking"), level: z.enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"]) }).strict(),
  z.object({ ...sessionCommandBase, type: z.literal("compact"), customInstructions: z.string().max(20_000).optional() }).strict(),
  z.object({ ...sessionCommandBase, type: z.literal("set_plan_mode"), mode: z.enum(["enter", "exit", "toggle", "status"]) }).strict(),
  z.object({ ...sessionCommandBase, type: z.literal("start_code_review"), diffType: z.string().optional(), defaultBranch: z.string().optional() }).strict(),
  z.object({
    ...sessionCommandBase, type: z.literal("extension_ui_response"), uiRequestId: requestId,
    value: text.optional(), confirmed: z.boolean().optional(), cancelled: z.boolean().optional(),
  }).strict(),
]);

export const clientMessageSchema = z.union([authMessageSchema, clientCommandSchema]);

export const modelSchema = z.object({
  provider: z.string(), id: z.string(), name: z.string().optional(), contextWindow: z.number().optional(),
}).passthrough();

export const contextUsageSchema = z.object({
  tokens: z.number().nonnegative().nullable(), contextWindow: z.number().positive(), percent: z.number().nonnegative().nullable(),
}).passthrough();

export const slashCommandSchema = z.object({
  name: z.string().min(1), description: z.string().optional(),
  source: z.enum(["extension", "prompt", "skill"]), scope: z.enum(["user", "project", "temporary"]),
}).strict();

export const sessionDescriptorSchema = z.object({
  sessionId, sessionFile: z.string().nullable(), sessionName: z.string().nullable(), cwd: z.string(),
  rpcStatus: z.enum(["starting", "ready", "error", "stopped"]), isRunning: z.boolean(), activeReviewId: z.string().nullable(),
}).strict();

export const sessionListSchema = z.object({
  type: z.literal("session_list"), version: z.literal(PROTOCOL_VERSION), sessions: z.array(sessionDescriptorSchema), maxSessions: z.number().int().positive(),
}).strict();

export const snapshotSchema = z.object({
  type: z.literal("snapshot"), version: z.literal(PROTOCOL_VERSION), sessionId, sessionFile: z.string().nullable(),
  sessionName: z.string().nullable(), cwd: z.string(), entries: z.array(z.unknown()), model: modelSchema.nullable(),
  availableModels: z.array(modelSchema), commands: z.array(slashCommandSchema), thinkingLevel: z.string(), isRunning: z.boolean(),
  contextUsage: contextUsageSchema.nullable(), planPhase: z.enum(["idle", "planning", "executing", "reviewing"]).default("idle"),
}).strict();

export const hostStateSchema = z.object({
  type: z.literal("host_state"), sessionId, rpcStatus: z.enum(["starting", "ready", "error", "stopped"]),
  activeReviewId: z.string().nullable().optional(), error: z.string().optional(),
}).strict();

export const eventMessageSchema = z.object({ type: z.literal("event"), sessionId, event: z.object({ type: z.string() }).passthrough() }).strict();
export const extensionUiRequestSchema = z.object({
  type: z.literal("extension_ui_request"), sessionId, id: requestId,
  method: z.enum(["select", "confirm", "input", "editor", "notify", "setStatus", "setWidget", "setTitle", "set_editor_text"]),
  title: z.string().optional(), message: z.string().optional(), options: z.array(z.string()).optional(), timeout: z.number().positive().optional(),
  placeholder: z.string().optional(), prefill: z.string().optional(), notifyType: z.enum(["info", "warning", "error"]).optional(),
  statusKey: z.string().optional(), statusText: z.string().optional(), widgetKey: z.string().optional(), widgetLines: z.array(z.string()).optional(),
  widgetPlacement: z.enum(["aboveEditor", "belowEditor"]).optional(), text: z.string().optional(),
}).passthrough();
export const responseMessageSchema = z.object({
  type: z.literal("response"), id: requestId, command: z.string(), sessionId: sessionId.optional(), success: z.boolean(), data: z.unknown().optional(), error: z.string().optional(),
}).strict();
export const reviewStartedSchema = z.object({
  type: z.literal("review_started"), sessionId, reviewId: z.string().min(1), kind: z.enum(["plan", "code"]), url: z.string().url(),
}).strict();
export const reviewFinishedSchema = z.object({
  type: z.literal("review_finished"), sessionId, reviewId: z.string().min(1), kind: z.enum(["plan", "code"]), approved: z.boolean().optional(), error: z.string().optional(),
}).strict();
export const errorMessageSchema = z.object({
  type: z.literal("error"), code: z.string(), message: z.string(), sessionId: sessionId.optional(), requestId: z.string().optional(),
}).strict();

export const serverMessageSchema = z.discriminatedUnion("type", [
  sessionListSchema, snapshotSchema, hostStateSchema, eventMessageSchema, extensionUiRequestSchema,
  responseMessageSchema, reviewStartedSchema, reviewFinishedSchema, errorMessageSchema,
]);

export type ClientCommand = z.infer<typeof clientCommandSchema>;
export type ClientCommandInput = ClientCommand extends infer C ? C extends { id: string } ? Omit<C, "id"> : never : never;
export type SessionCommandInput = ClientCommand extends infer C ? C extends { id: string; sessionId: string } ? Omit<C, "id" | "sessionId"> : never : never;
export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type ContextUsage = z.infer<typeof contextUsageSchema>;
export type ExtensionUiRequest = z.infer<typeof extensionUiRequestSchema>;
export type SessionDescriptor = z.infer<typeof sessionDescriptorSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
export type SlashCommand = z.infer<typeof slashCommandSchema>;
export type ServerMessage = z.infer<typeof serverMessageSchema>;
export type PiEvent = z.infer<typeof eventMessageSchema>["event"];
export type ReviewStarted = z.infer<typeof reviewStartedSchema>;
export type ReviewFinished = z.infer<typeof reviewFinishedSchema>;

export function parseClientMessage(value: unknown): ClientMessage { return clientMessageSchema.parse(value); }
export function parseServerMessage(value: unknown): ServerMessage { return serverMessageSchema.parse(value); }
