import { describe, expect, it } from "vitest";
import { emptySession, reducePiEvent, replaceFromSnapshot } from "./reducer";

const snapshot = (name: string, text: string) => ({
  type: "snapshot" as const, version: 2 as const, sessionFile: `${name}.jsonl`, sessionName: name, cwd: `/work/${name}`,
  entries: [{ type: "message", id: `${name}-1`, message: { role: "user", content: text } }], model: null,
  availableModels: [], thinkingLevel: "off", isRunning: false, contextUsage: null, planPhase: "idle" as const,
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

  it("authoritatively replaces stale state after reconnect", () => {
    const before = replaceFromSnapshot(snapshot("old", "stale"));
    const after = replaceFromSnapshot(snapshot("new", "fresh"));
    expect(before.messages[0]!.content).not.toEqual(after.messages[0]!.content);
    expect(after.messages).toHaveLength(1);
    expect(after.sessionName).toBe("new");
  });
});
