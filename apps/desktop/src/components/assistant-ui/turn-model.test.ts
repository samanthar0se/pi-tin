import { describe, expect, it } from "vitest";
import { createActivityViewModel, createTurnRenderModel, formatWorkedDuration, formatWorkText } from "./turn-model";

describe("createTurnRenderModel", () => {
  it("keeps direct answers out of a work disclosure", () => {
    expect(createTurnRenderModel([{ type: "text", text: "A direct answer." }])).toEqual({
      work: null,
      answerParts: [0],
    });
  });

  it("preserves repeated progress and activity ordering before the answer", () => {
    const model = createTurnRenderModel([
      { type: "text", text: "Checking the project." },
      { type: "tool-call", toolCallId: "read-1", toolName: "read", args: { path: "src/App.tsx" }, result: "file" },
      { type: "text", text: "Now running tests." },
      { type: "tool-call", toolCallId: "shell-1", toolName: "bash", args: { command: "pnpm test" }, result: "ok" },
      { type: "text", text: "Everything passes." },
    ], { messageStatus: { type: "complete" }, startedAtMs: 1_000, completedAtMs: 4_500 });

    expect(model.work?.status).toBe("complete");
    expect(model.work?.items.map((item) => [item.kind, "partIndex" in item ? item.partIndex : undefined])).toEqual([
      ["progress", 0], ["activity", 1], ["progress", 2], ["activity", 3],
    ]);
    expect(model.answerParts).toEqual([4]);
    expect(model.work?.completedAtMs).toBe(4_500);
  });

  it("creates a running placeholder before the first part arrives", () => {
    const model = createTurnRenderModel([], { messageStatus: { type: "running" }, startedAtMs: 2_000 });
    expect(model.work).toMatchObject({ status: "running", items: [], startedAtMs: 2_000 });
  });

  it("keeps unfinished tools running even during restoration", () => {
    const model = createTurnRenderModel([
      { type: "reasoning", text: "Checking" },
      { type: "tool-call", toolCallId: "tool-1", toolName: "bash" },
    ], { messageStatus: { type: "complete" } });
    expect(model.work?.status).toBe("running");
    expect(model.answerParts).toEqual([]);
  });

  it("groups consecutive shell calls without losing their order", () => {
    const model = createTurnRenderModel([
      { type: "reasoning", text: "Checking" },
      { type: "tool-call", toolCallId: "shell-1", toolName: "bash", args: { command: "pnpm test" }, result: "ok" },
      { type: "tool-call", toolCallId: "shell-2", toolName: "bash", args: { command: "pnpm typecheck" }, result: "ok" },
      { type: "text", text: "Done." },
    ], { messageStatus: { type: "complete" } });

    expect(model.work?.items).toHaveLength(2);
    expect(model.work?.items[1]).toMatchObject({
      kind: "activity-group",
      activities: [{ id: "shell-1" }, { id: "shell-2" }],
    });
    expect(model.answerParts).toEqual([3]);
  });

  it("marks tool errors and cancellations without hiding a final answer", () => {
    const failed = createTurnRenderModel([
      { type: "tool-call", toolName: "read", result: "not found", isError: true },
      { type: "text", text: "I could not read the file." },
    ], { messageStatus: { type: "incomplete", reason: "error" } });
    const cancelled = createTurnRenderModel([
      { type: "reasoning", text: "Working" },
    ], { messageStatus: { type: "incomplete", reason: "aborted" } });

    expect(failed.work?.status).toBe("error");
    expect(failed.answerParts).toEqual([1]);
    expect(cancelled.work?.status).toBe("cancelled");
  });
});

describe("activity summaries", () => {
  it("derives semantic file and command labels", () => {
    expect(createActivityViewModel({
      type: "tool-call", toolName: "functions.read", args: { path: "C:\\repo\\src\\App.tsx" }, result: "ok",
    }, 0)).toMatchObject({ kind: "read", summary: "Read App.tsx", detailSummary: "C:\\repo\\src\\App.tsx" });

    expect(createActivityViewModel({
      type: "tool-call", toolName: "bash", args: { command: "pnpm vitest run turn-model.test.ts" }, result: "ok",
    }, 1)).toMatchObject({ kind: "shell", summary: "Ran a command", detailSummary: "Ran pnpm vitest run turn-model.test.ts" });
  });

  it("uses restrained failed and running copy", () => {
    expect(createActivityViewModel({ type: "tool-call", toolName: "write", args: { path: "notes.md" } }, 0).summary).toBe("Creating notes.md");
    expect(createActivityViewModel({ type: "tool-call", toolName: "web_search", result: "failed", isError: true }, 1).summary).toBe("Web request failed");
  });

  it("humanizes extension tool names", () => {
    expect(createActivityViewModel({ type: "tool-call", toolName: "acme.render_report", result: "ok" }, 0).summary).toBe("Used Render report");
  });
});

describe("formatWorkedDuration", () => {
  it("formats compact elapsed time", () => {
    expect(formatWorkedDuration(40 * 60_000 + 42_000)).toBe("40m 42s");
    expect(formatWorkedDuration(3_200)).toBe("3s");
    expect(formatWorkedDuration(3_661_000)).toBe("1h 1m");
  });
});

describe("formatWorkText", () => {
  it("removes raw progress markdown and excess whitespace", () => {
    expect(formatWorkText("  **Inspecting build output**\n\n\n## Next step  ")).toBe("Inspecting build output\n\nNext step");
  });
});
