import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION } from "@pi-tin/protocol";
import { emptySession, reducePiEvent, replaceFromSnapshot } from "./reducer";

const snapshot = (name: string, text: string) => ({
  type: "snapshot" as const, version: PROTOCOL_VERSION, sessionId: name, sessionFile: `${name}.jsonl`, sessionName: name, cwd: `/work/${name}`,
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
    expect((state.messages[0]!.content as any[])[2]).toMatchObject({ isRunning: true });
    state = reducePiEvent(state, { type: "tool_execution_update", toolCallId: "t1", partialResult: { content: [{ type: "text", text: "partial" }] } });
    expect((state.messages[0]!.content as any[])[2]).toMatchObject({ result: "partial", isRunning: true });
    state = reducePiEvent(state, { type: "tool_execution_end", toolCallId: "t1", result: { content: [{ type: "text", text: "file" }] }, isError: false });
    const parts = state.messages[0]!.content as any[];
    expect(parts.map((part) => part.type)).toEqual(["reasoning", "text", "tool-call"]);
    expect(parts[2]).toMatchObject({ result: "file", isRunning: false });
    expect(state.isRunning).toBe(true);
  });

  it("keeps tool turns and the final answer in one assistant task", () => {
    let state = reducePiEvent(emptySession, { type: "agent_start", timestamp: "2026-07-14T12:00:00.000Z" });
    state = reducePiEvent(state, { type: "message_start", message: { id: "a1", role: "assistant", content: [] } });
    state = reducePiEvent(state, { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Checking." } });
    state = reducePiEvent(state, { type: "message_end", message: { id: "a1", role: "assistant", content: [{ type: "text", text: "Checking." }, { type: "toolCall", id: "t1", name: "read", arguments: { path: "a.ts" } }] } });
    state = reducePiEvent(state, { type: "tool_execution_start", toolCallId: "t1", toolName: "read", args: { path: "a.ts" } });
    state = reducePiEvent(state, { type: "tool_execution_end", toolCallId: "t1", result: { content: [{ type: "text", text: "file" }] }, isError: false });
    state = reducePiEvent(state, { type: "message_start", message: { id: "a2", role: "assistant", content: [] } });
    state = reducePiEvent(state, { type: "message_update", timestamp: "2026-07-14T12:02:03.000Z", assistantMessageEvent: { type: "text_delta", delta: "Done." } });
    state = reducePiEvent(state, { type: "message_end", timestamp: "2026-07-14T12:02:03.000Z", message: { id: "a2", role: "assistant", content: [{ type: "text", text: "Done." }] } });

    expect(state.messages).toHaveLength(1);
    expect((state.messages[0]!.content as any[]).map((part) => part.type)).toEqual(["text", "tool-call", "text"]);
    expect((state.messages[0]!.content as any[]).map((part) => part.text).filter(Boolean)).toEqual(["Checking.", "Done."]);
    expect((state.messages[0]!.content as any[])[1].result).toBe("file");
    expect(state.messages[0]!.metadata?.custom).toMatchObject({ startedAtMs: 1_784_030_400_000, completedAtMs: 1_784_030_523_000 });
  });

  it("authoritatively replaces stale state after reconnect", () => {
    const before = replaceFromSnapshot(snapshot("old", "stale"));
    const after = replaceFromSnapshot(snapshot("new", "fresh"));
    expect(before.messages[0]!.content).not.toEqual(after.messages[0]!.content);
    expect(after.messages).toHaveLength(1);
    expect(after.sessionName).toBe("new");
    expect(after.commands[0]?.name).toBe("skill:test");
  });

  it("restores worked timing from transcript timestamps", () => {
    const state = replaceFromSnapshot({
      ...snapshot("timed", "ignored"),
      entries: [
        { type: "message", id: "u1", timestamp: "2026-07-14T12:00:00.000Z", message: { role: "user", content: "Start" } },
        { type: "message", id: "a1", timestamp: "2026-07-14T12:01:00.000Z", message: { role: "assistant", content: [{ type: "thinking", thinking: "Checking" }] } },
        { type: "message", id: "a2", timestamp: "2026-07-14T12:02:03.000Z", message: { role: "assistant", content: "Done." } },
      ],
    });

    expect(state.messages[1]!.metadata?.custom).toMatchObject({ startedAtMs: 1_784_030_400_000, completedAtMs: 1_784_030_523_000 });
  });

  it("updates context usage from host events", () => {
    const contextUsage = { tokens: 72_000, contextWindow: 128_000, percent: 56.25 };
    const state = reducePiEvent(emptySession, { type: "context_usage", contextUsage });
    expect(state.contextUsage).toEqual(contextUsage);
  });

  it("preserves user image content for display", () => {
    const state = replaceFromSnapshot({
      ...snapshot("image", "ignored"),
      entries: [{
        type: "message", id: "image-1", message: { role: "user", content: [
          { type: "text", text: "What is this?" },
          { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
        ] },
      }],
    });
    expect(state.messages[0]!.content).toEqual([
      { type: "text", text: "What is this?" },
      { type: "image", image: "data:image/png;base64,aGVsbG8=" },
    ]);
  });
});
