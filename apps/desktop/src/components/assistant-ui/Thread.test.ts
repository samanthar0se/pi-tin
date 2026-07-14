import { describe, expect, it } from "vitest";
import { isTaskActivityRunning, summarizeTaskActivity } from "./Thread";

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
