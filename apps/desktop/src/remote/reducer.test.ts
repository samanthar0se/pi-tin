import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION } from "@pi-tin/protocol";
import { emptySession, reducePiEvent, replaceFromSnapshot } from "./reducer";

const snapshot = (name: string, text: string) => ({
  type: "snapshot" as const, version: PROTOCOL_VERSION, sessionFile: `${name}.jsonl`, sessionName: name, cwd: `/work/${name}`,
  entries: [{ type: "message", id: `${name}-1`, message: { role: "user", content: text } }], model: null,
  availableModels: [], commands: [{ name: "skill:test", description: "Test skill", source: "skill" as const, scope: "user" as const }],
  thinkingLevel: "off", isRunning: false, contextUsage: null, planPhase: "idle" as const,
});

describe("Pi state reduction", () => {
  it("reduces streamed text, thinking, and tool lifecycle", () => {
    let state = reducePiEvent(emptySession, { type: "message_start", message: { id: "a1", role: "assistant", content: [] } });
    state = reducePiEvent(state, { type: "agent_start" });
    state = reducePiEvent(state, { type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "checking" } });
    state = reducePiEvent(state, { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "done" } });
    state = reducePiEvent(state, { type: "tool_execution_start", toolCallId: "t1", toolName: "read", args: { path: "a.ts" } });
    state = reducePiEvent(state, { type: "tool_execution_end", toolCallId: "t1", result: { content: [{ type: "text", text: "file" }] }, isError: false });
    const parts = state.messages[0]!.content as any[];
    expect(parts.map((part) => part.type)).toEqual(["reasoning", "text", "tool-call"]);
    expect(parts[2].result).toBe("file");
    expect(state.isRunning).toBe(true);
  });

  it("keeps tool turns and the final answer in one assistant task", () => {
    let state = reducePiEvent(emptySession, { type: "agent_start" });
    state = reducePiEvent(state, { type: "message_start", message: { id: "a1", role: "assistant", content: [] } });
    state = reducePiEvent(state, { type: "message_end", message: { id: "a1", role: "assistant", content: [{ type: "text", text: "Checking." }, { type: "toolCall", id: "t1", name: "read", arguments: { path: "a.ts" } }] } });
    state = reducePiEvent(state, { type: "tool_execution_start", toolCallId: "t1", toolName: "read", args: { path: "a.ts" } });
    state = reducePiEvent(state, { type: "tool_execution_end", toolCallId: "t1", result: { content: [{ type: "text", text: "file" }] }, isError: false });
    state = reducePiEvent(state, { type: "message_start", message: { id: "a2", role: "assistant", content: [] } });
    state = reducePiEvent(state, { type: "message_end", message: { id: "a2", role: "assistant", content: [{ type: "text", text: "Done." }] } });

    expect(state.messages).toHaveLength(1);
    expect((state.messages[0]!.content as any[]).map((part) => part.type)).toEqual(["text", "tool-call", "text"]);
    expect((state.messages[0]!.content as any[])[1].result).toBe("file");
  });

  it("authoritatively replaces stale state after reconnect", () => {
    const before = replaceFromSnapshot(snapshot("old", "stale"));
    const after = replaceFromSnapshot(snapshot("new", "fresh"));
    expect(before.messages[0]!.content).not.toEqual(after.messages[0]!.content);
    expect(after.messages).toHaveLength(1);
    expect(after.sessionName).toBe("new");
    expect(after.commands[0]?.name).toBe("skill:test");
  });

  it("updates context usage from host events", () => {
    const contextUsage = { tokens: 72_000, contextWindow: 128_000, percent: 56.25 };
    const state = reducePiEvent(emptySession, { type: "context_usage", contextUsage });
    expect(state.contextUsage).toEqual(contextUsage);
  });
});
