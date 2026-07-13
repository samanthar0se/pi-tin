import { z } from "zod";

export const PROTOCOL_VERSION = 1 as const;
const requestId = z.string().min(1).max(128);
const text = z.string().max(2_000_000);

export const authMessageSchema = z.object({
  type: z.literal("auth"),
  version: z.literal(PROTOCOL_VERSION),
  token: z.string().min(1).max(4096),
}).strict();

const commandBase = { id: requestId } as const;
export const clientCommandSchema = z.discriminatedUnion("type", [
  z.object({ ...commandBase, type: z.literal("prompt"), message: text }).strict(),
  z.object({ ...commandBase, type: z.literal("steer"), message: text }).strict(),
  z.object({ ...commandBase, type: z.literal("follow_up"), message: text }).strict(),
  z.object({ ...commandBase, type: z.literal("abort") }).strict(),
  z.object({ ...commandBase, type: z.literal("set_model"), provider: z.string().min(1), modelId: z.string().min(1) }).strict(),
  z.object({ ...commandBase, type: z.literal("set_thinking"), level: z.enum(["off", "minimal", "low", "medium", "high", "xhigh"]) }).strict(),
  z.object({ ...commandBase, type: z.literal("compact"), customInstructions: z.string().max(20_000).optional() }).strict(),
  z.object({ ...commandBase, type: z.literal("set_plan_mode"), mode: z.enum(["enter", "exit", "toggle", "status"]) }).strict(),
  z.object({ ...commandBase, type: z.literal("start_code_review"), diffType: z.string().optional(), defaultBranch: z.string().optional() }).strict(),
]);

export const clientMessageSchema = z.union([authMessageSchema, clientCommandSchema]);

export const modelSchema = z.object({
  provider: z.string(),
  id: z.string(),
  name: z.string().optional(),
  contextWindow: z.number().optional(),
}).passthrough();

export const snapshotSchema = z.object({
  type: z.literal("snapshot"),
  version: z.literal(PROTOCOL_VERSION),
  sessionFile: z.string().nullable(),
  sessionName: z.string().nullable(),
  cwd: z.string(),
  entries: z.array(z.unknown()),
  model: modelSchema.nullable(),
  availableModels: z.array(modelSchema),
  thinkingLevel: z.string(),
  isRunning: z.boolean(),
  contextUsage: z.unknown().nullable(),
  planPhase: z.enum(["idle", "planning", "executing", "reviewing"]).default("idle"),
}).strict();

export const eventMessageSchema = z.object({
  type: z.literal("event"),
  event: z.object({ type: z.string() }).passthrough(),
}).strict();

export const responseMessageSchema = z.object({
  type: z.literal("response"),
  id: requestId,
  command: z.string(),
  success: z.boolean(),
  data: z.unknown().optional(),
  error: z.string().optional(),
}).strict();

export const reviewStartedSchema = z.object({
  type: z.literal("review_started"),
  reviewId: z.string().min(1),
  kind: z.enum(["plan", "code"]),
  url: z.string().url(),
}).strict();

export const reviewFinishedSchema = z.object({
  type: z.literal("review_finished"),
  reviewId: z.string().min(1),
  kind: z.enum(["plan", "code"]),
  approved: z.boolean().optional(),
  error: z.string().optional(),
}).strict();

export const errorMessageSchema = z.object({
  type: z.literal("error"),
  code: z.string(),
  message: z.string(),
  requestId: z.string().optional(),
}).strict();

export const serverMessageSchema = z.discriminatedUnion("type", [
  snapshotSchema,
  eventMessageSchema,
  responseMessageSchema,
  reviewStartedSchema,
  reviewFinishedSchema,
  errorMessageSchema,
]);

export type AuthMessage = z.infer<typeof authMessageSchema>;
export type ClientCommand = z.infer<typeof clientCommandSchema>;
export type ClientCommandInput = ClientCommand extends infer C ? C extends { id: string } ? Omit<C, "id"> : never : never;
export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
export type ServerMessage = z.infer<typeof serverMessageSchema>;
export type PiEvent = z.infer<typeof eventMessageSchema>["event"];
export type ReviewStarted = z.infer<typeof reviewStartedSchema>;
export type ReviewFinished = z.infer<typeof reviewFinishedSchema>;

export function parseClientMessage(value: unknown): ClientMessage {
  return clientMessageSchema.parse(value);
}

export function parseServerMessage(value: unknown): ServerMessage {
  return serverMessageSchema.parse(value);
}
