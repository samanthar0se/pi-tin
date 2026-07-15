import type { ContextUsage, SlashCommand, Snapshot } from "@pi-tin/protocol";
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
  operation: "idle" | "agent" | "compacting";
  contextUsage: ContextUsage | null;
  planPhase: "idle" | "planning" | "executing" | "reviewing";
  activeAssistantPartStart: number | null;
  activeTurnStartedAtMs: number | null;
};

export const emptySession: SessionState = {
  messages: [], sessionFile: null, sessionName: null, cwd: "", model: null,
  availableModels: [], commands: [], thinkingLevel: "off", isRunning: false, operation: "idle", contextUsage: null, planPhase: "idle",
  activeAssistantPartStart: null, activeTurnStartedAtMs: null,
};

function asObject(value: unknown): Record<string, any> {
  return value && typeof value === "object" ? value as Record<string, any> : {};
}

function textPhase(part: any): "commentary" | "final_answer" | undefined {
  if (part?.phase === "commentary" || part?.phase === "final_answer") return part.phase;
  if (typeof part?.textSignature !== "string") return undefined;
  try {
    const phase = JSON.parse(part.textSignature)?.phase;
    return phase === "commentary" || phase === "final_answer" ? phase : undefined;
  } catch {
    return undefined;
  }
}

function contentParts(message: any): any[] {
  const content = message?.content;
  if (typeof content === "string") return content ? [{ type: "text", text: content }] : [];
  if (!Array.isArray(content)) return [];
  return content.flatMap((part: any): any[] => {
    if (part?.type === "text") {
      const phase = textPhase(part);
      return [{ type: "text", text: String(part.text || ""), ...(phase ? { phase } : {}) }];
    }
    if (part?.type === "image" && typeof part.data === "string" && typeof part.mimeType === "string") {
      return [{ type: "image", image: `data:${part.mimeType};base64,${part.data}` }];
    }
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

function timestampMs(value: unknown): number | undefined {
  if (value == null) return undefined;
  const timestamp = new Date(value as string | number).getTime();
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function withTiming(message: UiMessage, startedAtMs: number, completedAtMs?: number): UiMessage {
  const metadata = message.metadata ?? {};
  return {
    ...message,
    metadata: { ...metadata, custom: { ...metadata.custom, startedAtMs, ...(completedAtMs === undefined ? {} : { completedAtMs }) } },
  } as UiMessage;
}

function clearCompletedTiming(message: UiMessage): UiMessage {
  const metadata = message.metadata ?? {};
  const { completedAtMs: _completedAtMs, ...custom } = metadata.custom ?? {};
  return { ...message, metadata: { ...metadata, custom } } as UiMessage;
}

export function normalizeEntries(entries: unknown[]): UiMessage[] {
  const messages: UiMessage[] = [];
  const toolLocations = new Map<string, { message: UiMessage; index: number }>();
  let turnStartedAtMs: number | undefined;
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
        const completedAtMs = timestampMs(entry.timestamp);
        if (completedAtMs !== undefined) Object.assign(previous, withTiming(previous, Number(previous.metadata?.custom?.startedAtMs ?? completedAtMs), completedAtMs));
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
      const entryTimestampMs = timestampMs(entry.timestamp);
      const timed = message.role === "assistant" && entryTimestampMs !== undefined
        ? withTiming(normalized, turnStartedAtMs ?? entryTimestampMs, entryTimestampMs)
        : normalized;
      messages.push(timed);
      if (message.role === "user") turnStartedAtMs = entryTimestampMs;
      parts.forEach((part, partIndex) => {
        if (part.type === "tool-call" && part.toolCallId) toolLocations.set(part.toolCallId, { message: timed, index: partIndex });
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
    isRunning: snapshot.isRunning, operation: snapshot.isRunning ? "agent" : "idle", contextUsage: snapshot.contextUsage, planPhase: snapshot.planPhase,
    activeAssistantPartStart: null, activeTurnStartedAtMs: null,
  };
}

function findLastMatching<T>(items: T[], predicate: (item: T) => boolean, startIndex = 0): number {
  for (let index = items.length - 1; index >= startIndex; index--) if (predicate(items[index]!)) return index;
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
    case "agent_start": return { ...state, isRunning: true, operation: "agent", activeTurnStartedAtMs: timestampMs(event.timestamp) ?? Date.now() };
    case "agent_end":
    case "agent_settled": return { ...state, isRunning: false, operation: "idle", activeTurnStartedAtMs: null };
    case "message_start": {
      const msg = asObject(event.message);
      if (msg.role !== "assistant" && msg.role !== "user") return state;
      const initialParts = contentParts(msg);
      const previous = state.messages.at(-1);
      if (msg.role === "assistant" && previous?.role === "assistant") {
        const start = (previous.content as any[]).length;
        return { ...state, activeAssistantPartStart: start, messages: updateLastAssistant(state.messages, (message) => ({
          ...clearCompletedTiming(message), content: [...message.content as any[], ...initialParts], status: { type: "running" },
        } as UiMessage)) };
      }
      const startedAtMs = state.activeTurnStartedAtMs ?? timestampMs(event.timestamp ?? msg.timestamp) ?? Date.now();
      const next: UiMessage = {
        id: String(msg.id ?? `live-${Date.now()}-${state.messages.length}`), role: msg.role,
        content: initialParts, createdAt: new Date(startedAtMs),
        ...(msg.role === "assistant" ? { status: { type: "running" } } : {}),
      } as UiMessage;
      const timed = msg.role === "assistant" ? withTiming(next, startedAtMs) : next;
      const duplicate = state.messages.some((item) => item.id === next.id);
      return duplicate ? state : { ...state, activeAssistantPartStart: msg.role === "assistant" ? 0 : null, messages: [...state.messages, timed] };
    }
    case "message_update": {
      const delta = asObject(event.assistantMessageEvent);
      if (delta.type !== "text_delta" && delta.type !== "thinking_delta" && delta.type !== "reasoning_delta") return state;
      const type = delta.type === "text_delta" ? "text" : "reasoning";
      const partialContent = Array.isArray(delta.partial?.content) ? delta.partial.content : [];
      const phase = type === "text" ? textPhase(partialContent[Number(delta.contentIndex)]) : undefined;
      return { ...state, messages: updateLastAssistant(state.messages, (message) => {
        const parts = [...(message.content as any[])];
        let index = findLastMatching(parts, (part: any) => part.type === type, state.activeAssistantPartStart ?? 0);
        if (index < 0) { parts.push({ type, text: "", ...(phase ? { phase } : {}) }); index = parts.length - 1; }
        parts[index] = { ...parts[index], text: String(parts[index].text || "") + String(delta.delta || ""), ...(phase ? { phase } : {}) };
        const updated = { ...message, content: parts, status: { type: "running" } } as UiMessage;
        const finalAnswerStarted = type === "text" && phase === "final_answer";
        return finalAnswerStarted && typeof message.metadata?.custom?.completedAtMs !== "number"
          ? withTiming(updated, Number(message.metadata?.custom?.startedAtMs ?? Date.now()), timestampMs(event.timestamp) ?? Date.now())
          : updated;
      }) };
    }
    case "message_end": {
      const msg = asObject(event.message);
      if (msg.role !== "assistant") return state;
      const finalizedParts = contentParts(msg);
      const continuesWithTools = msg.stopReason === "toolUse";
      return { ...state, messages: updateLastAssistant(state.messages, (current) => {
        const timed = continuesWithTools
          ? clearCompletedTiming(current)
          : withTiming(
            current,
            Number(current.metadata?.custom?.startedAtMs ?? Date.now()),
            Number(current.metadata?.custom?.completedAtMs ?? timestampMs(event.timestamp ?? msg.timestamp) ?? Date.now()),
          );
        return {
          ...timed,
          content: state.activeAssistantPartStart === null
          ? finalizedParts
          : [...(current.content as any[]).slice(0, state.activeAssistantPartStart), ...finalizedParts],
          status: continuesWithTools
            ? { type: "running" }
            : msg.stopReason === "error" ? { type: "incomplete", reason: "error" } : { type: "complete", reason: "stop" },
        } as UiMessage;
      }), activeAssistantPartStart: null };
    }
    case "tool_execution_start":
      return { ...state, messages: updateLastAssistant(state.messages, (message) => {
        const parts = [...message.content as any[]];
        const index = parts.findIndex((part) => part.type === "tool-call" && part.toolCallId === event.toolCallId);
        const toolPart = {
          type: "tool-call", toolCallId: String(event.toolCallId), toolName: String(event.toolName), args: asObject(event.args), argsText: JSON.stringify(event.args ?? {}, null, 2), isRunning: true,
        };
        if (index < 0) parts.push(toolPart);
        else parts[index] = { ...parts[index], ...toolPart };
        return { ...clearCompletedTiming(message), content: parts, status: { type: "running" } } as UiMessage;
      }) };
    case "tool_execution_update":
    case "tool_execution_end":
      return { ...state, messages: updateLastAssistant(state.messages, (message) => ({ ...message, content: (message.content as any[]).map((part) =>
        part.type === "tool-call" && part.toolCallId === event.toolCallId
          ? { ...part, result: toolResultText(event.type === "tool_execution_end" ? event.result : event.partialResult), isRunning: event.type === "tool_execution_update", ...(event.type === "tool_execution_end" ? { isError: Boolean(event.isError) } : {}) }
          : part) } as UiMessage)) };
    case "model_select": return { ...state, model: event.model ?? state.model };
    case "thinking_level_select": return { ...state, thinkingLevel: String(event.level ?? state.thinkingLevel) };
    case "context_usage": return { ...state, contextUsage: event.contextUsage ?? null };
    case "plan_phase": return { ...state, planPhase: event.phase };
    case "session_before_compact":
    case "compaction_start": return { ...state, isRunning: true, operation: "compacting" };
    case "session_compact":
    case "compaction_end": {
      const agentRunning = state.activeTurnStartedAtMs !== null;
      return { ...state, isRunning: agentRunning, operation: agentRunning ? "agent" : "idle" };
    }
    default: return state;
  }
}
