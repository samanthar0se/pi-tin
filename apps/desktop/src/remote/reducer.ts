import type { ContextUsage, SlashCommand, Snapshot } from "@pi-remote/protocol";
import type { ThreadMessageLike } from "@assistant-ui/react";

export type UiMessage = ThreadMessageLike & { id: string };
export type SessionState = {
  messages: UiMessage[];
  sessionFile: string | null;
  sessionName: string | null;
  cwd: string;
  model: any | null;
  availableModels: any[];
  commands: SlashCommand[];
  thinkingLevel: string;
  isRunning: boolean;
  contextUsage: ContextUsage | null;
  planPhase: "idle" | "planning" | "executing" | "reviewing";
  activeAssistantPartStart: number | null;
};

export const emptySession: SessionState = {
  messages: [], sessionFile: null, sessionName: null, cwd: "", model: null,
  availableModels: [], commands: [], thinkingLevel: "off", isRunning: false, contextUsage: null, planPhase: "idle",
  activeAssistantPartStart: null,
};

function asObject(value: unknown): Record<string, any> {
  return value && typeof value === "object" ? value as Record<string, any> : {};
}

function contentParts(message: any): any[] {
  const content = message?.content;
  if (typeof content === "string") return content ? [{ type: "text", text: content }] : [];
  if (!Array.isArray(content)) return [];
  return content.flatMap((part: any): any[] => {
    if (part?.type === "text") return [{ type: "text", text: String(part.text || "") }];
    if (part?.type === "thinking" || part?.type === "reasoning") return [{ type: "reasoning", text: String(part.thinking ?? part.text ?? "") }];
    if (part?.type === "toolCall" || part?.type === "tool-call") return [{
      type: "tool-call", toolCallId: String(part.id ?? part.toolCallId ?? ""),
      toolName: String(part.name ?? part.toolName ?? "tool"), args: asObject(part.arguments ?? part.args),
      argsText: JSON.stringify(part.arguments ?? part.args ?? {}, null, 2),
    }];
    return [];
  });
}

function messageId(entry: any, index: number): string {
  return String(entry?.id ?? entry?.entryId ?? entry?.message?.id ?? `entry-${index}`);
}

export function normalizeEntries(entries: unknown[]): UiMessage[] {
  const messages: UiMessage[] = [];
  const toolLocations = new Map<string, { message: UiMessage; index: number }>();
  entries.forEach((raw, index) => {
    const entry = asObject(raw);
    if (entry.type !== "message") return;
    const message = asObject(entry.message);
    if (message.role === "user" || message.role === "assistant") {
      const parts = contentParts(message);
      const previous = messages.at(-1);
      if (message.role === "assistant" && previous?.role === "assistant") {
        const offset = (previous.content as any[]).length;
        (previous as any).content = [...previous.content as any[], ...parts];
        (previous as any).status = message.stopReason === "error" ? { type: "incomplete", reason: "error" } : { type: "complete", reason: "stop" };
        parts.forEach((part, partIndex) => {
          if (part.type === "tool-call" && part.toolCallId) toolLocations.set(part.toolCallId, { message: previous, index: offset + partIndex });
        });
        return;
      }
      const normalized: UiMessage = {
        id: messageId(entry, index), role: message.role, content: parts,
        createdAt: entry.timestamp ? new Date(entry.timestamp) : undefined,
        ...(message.role === "assistant" ? { status: message.stopReason === "error" ? { type: "incomplete", reason: "error" } : { type: "complete", reason: "stop" } } : {}),
      } as UiMessage;
      messages.push(normalized);
      parts.forEach((part, partIndex) => {
        if (part.type === "tool-call" && part.toolCallId) toolLocations.set(part.toolCallId, { message: normalized, index: partIndex });
      });
      return;
    }
    if (message.role === "toolResult") {
      const id = String(message.toolCallId ?? "");
      const location = toolLocations.get(id);
      if (!location) return;
      const parts = [...(location.message.content as any[])];
      parts[location.index] = { ...parts[location.index], result: toolResultText(message), isError: Boolean(message.isError) };
      (location.message as any).content = parts;
    }
  });
  return messages;
}

function toolResultText(result: any): string {
  const content = result?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return result == null ? "" : JSON.stringify(result, null, 2);
  return content.map((part: any) => part?.type === "text" ? part.text : JSON.stringify(part)).join("\n");
}

export function replaceFromSnapshot(snapshot: Snapshot): SessionState {
  return {
    messages: normalizeEntries(snapshot.entries), sessionFile: snapshot.sessionFile,
    sessionName: snapshot.sessionName, cwd: snapshot.cwd, model: snapshot.model,
    availableModels: [...snapshot.availableModels], commands: [...snapshot.commands], thinkingLevel: snapshot.thinkingLevel,
    isRunning: snapshot.isRunning, contextUsage: snapshot.contextUsage, planPhase: snapshot.planPhase, activeAssistantPartStart: null,
  };
}

function findLastMatching<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index--) if (predicate(items[index]!)) return index;
  return -1;
}

function updateLastAssistant(messages: UiMessage[], updater: (message: UiMessage) => UiMessage): UiMessage[] {
  const index = findLastMatching(messages, (message) => message.role === "assistant");
  if (index < 0) return messages;
  const copy = [...messages];
  copy[index] = updater(copy[index]!);
  return copy;
}

export function reducePiEvent(state: SessionState, rawEvent: unknown): SessionState {
  const event = asObject(rawEvent);
  switch (event.type) {
    case "agent_start": return { ...state, isRunning: true };
    case "agent_end":
    case "agent_settled": return { ...state, isRunning: false };
    case "message_start": {
      const msg = asObject(event.message);
      if (msg.role !== "assistant" && msg.role !== "user") return state;
      const initialParts = contentParts(msg);
      const previous = state.messages.at(-1);
      if (msg.role === "assistant" && previous?.role === "assistant") {
        const start = (previous.content as any[]).length;
        return { ...state, activeAssistantPartStart: start, messages: updateLastAssistant(state.messages, (message) => ({
          ...message, content: [...message.content as any[], ...initialParts], status: { type: "running" },
        } as UiMessage)) };
      }
      const next: UiMessage = {
        id: String(msg.id ?? `live-${Date.now()}-${state.messages.length}`), role: msg.role,
        content: initialParts,
        ...(msg.role === "assistant" ? { status: { type: "running" } } : {}),
      } as UiMessage;
      const duplicate = state.messages.some((item) => item.id === next.id);
      return duplicate ? state : { ...state, activeAssistantPartStart: msg.role === "assistant" ? 0 : null, messages: [...state.messages, next] };
    }
    case "message_update": {
      const delta = asObject(event.assistantMessageEvent);
      if (delta.type !== "text_delta" && delta.type !== "thinking_delta" && delta.type !== "reasoning_delta") return state;
      const type = delta.type === "text_delta" ? "text" : "reasoning";
      return { ...state, messages: updateLastAssistant(state.messages, (message) => {
        const parts = [...(message.content as any[])];
        let index = findLastMatching(parts, (part: any) => part.type === type);
        if (index < 0) { parts.push({ type, text: "" }); index = parts.length - 1; }
        parts[index] = { ...parts[index], text: String(parts[index].text || "") + String(delta.delta || "") };
        return { ...message, content: parts, status: { type: "running" } } as UiMessage;
      }) };
    }
    case "message_end": {
      const msg = asObject(event.message);
      if (msg.role !== "assistant") return state;
      const finalizedParts = contentParts(msg);
      return { ...state, messages: updateLastAssistant(state.messages, (current) => ({
        ...current,
        content: state.activeAssistantPartStart === null
          ? finalizedParts
          : [...(current.content as any[]).slice(0, state.activeAssistantPartStart), ...finalizedParts],
        status: msg.stopReason === "error" ? { type: "incomplete", reason: "error" } : { type: "complete", reason: "stop" },
      } as UiMessage)), activeAssistantPartStart: null };
    }
    case "tool_execution_start":
      return { ...state, messages: updateLastAssistant(state.messages, (message) => {
        const parts = [...message.content as any[]];
        const index = parts.findIndex((part) => part.type === "tool-call" && part.toolCallId === event.toolCallId);
        const toolPart = {
          type: "tool-call", toolCallId: String(event.toolCallId), toolName: String(event.toolName), args: asObject(event.args), argsText: JSON.stringify(event.args ?? {}, null, 2),
        };
        if (index < 0) parts.push(toolPart);
        else parts[index] = { ...parts[index], ...toolPart };
        return { ...message, content: parts, status: { type: "running" } } as UiMessage;
      }) };
    case "tool_execution_update":
    case "tool_execution_end":
      return { ...state, messages: updateLastAssistant(state.messages, (message) => ({ ...message, content: (message.content as any[]).map((part) =>
        part.type === "tool-call" && part.toolCallId === event.toolCallId
          ? { ...part, result: toolResultText(event.type === "tool_execution_end" ? event.result : event.partialResult), ...(event.type === "tool_execution_end" ? { isError: Boolean(event.isError) } : {}) }
          : part) } as UiMessage)) };
    case "model_select": return { ...state, model: event.model ?? state.model };
    case "thinking_level_select": return { ...state, thinkingLevel: String(event.level ?? state.thinkingLevel) };
    case "context_usage": return { ...state, contextUsage: event.contextUsage ?? null };
    case "plan_phase": return { ...state, planPhase: event.phase };
    case "session_before_compact":
    case "compaction_start": return { ...state, isRunning: true };
    case "session_compact":
    case "compaction_end": return { ...state, isRunning: false };
    default: return state;
  }
}
