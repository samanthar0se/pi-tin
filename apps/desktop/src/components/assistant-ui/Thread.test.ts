import { describe, expect, it } from "vitest";
import { groupTaskParts, isTaskActivityRunning, summarizeTaskActivity } from "./Thread";

describe("task activity grouping", () => {
  it("folds progress text and tools into one work slice", () => {
    const parts = [
      { type: "text", text: "Checking the project." },
      { type: "tool-call", toolName: "read", result: "file" },
      { type: "text", text: "Now running the tests." },
      { type: "tool-call", toolName: "bash", result: "ok" },
      { type: "text", text: "Everything passes." },
    ];

    expect(groupTaskParts(parts)).toEqual([
      { groupKey: "task-activity-0", indices: [0, 1, 2, 3] },
      { groupKey: undefined, indices: [4] },
    ]);
  });

  it("leaves text-only responses ungrouped", () => {
    expect(groupTaskParts([{ type: "text", text: "A direct answer." }])).toEqual([
      { groupKey: undefined, indices: [0] },
    ]);
  });
});

describe("task activity status", () => {
  it("marks only the latest activity group as running", () => {
    const parts = [
      { type: "reasoning", text: "first" },
      { type: "text", text: "Progress update" },
      { type: "reasoning", text: "second" },
      { type: "text", text: "Another update" },
      { type: "reasoning", text: "current" },
    ];

    expect(isTaskActivityRunning(parts, [0], true)).toBe(false);
    expect(isTaskActivityRunning(parts, [2], true)).toBe(false);
    expect(isTaskActivityRunning(parts, [4], true)).toBe(true);
  });

  it("keeps the latest unfinished tool group running", () => {
    const parts = [
      { type: "reasoning", text: "checking" },
      { type: "tool-call", toolCallId: "tool-1" },
    ];

    expect(isTaskActivityRunning(parts, [0, 1], false)).toBe(true);
  });

  it("stops the work indicator when the final answer starts", () => {
    const parts = [
      { type: "tool-call", toolCallId: "tool-1", result: "done" },
      { type: "text", text: "Here is the result." },
    ];

    expect(isTaskActivityRunning(parts, [0], true)).toBe(false);
  });
});

describe("task activity summary", () => {
  it("summarizes completed work by semantic activity", () => {
    const tools = [
      { toolName: "read", result: "file" },
      { toolName: "grep", result: "matches" },
      { toolName: "bash", result: "ok" },
    ];

    expect(summarizeTaskActivity(tools, false).label).toBe("Read a file, searched code, and ran a command");
  });

  it("describes only unfinished work while running", () => {
    const tools = [
      { toolName: "read", result: "file" },
      { toolName: "apply_patch" },
    ];

    expect(summarizeTaskActivity(tools, true)).toEqual({ kind: "edit", label: "Editing files" });
  });
});
