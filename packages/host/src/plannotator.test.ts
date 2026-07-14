import { describe, expect, it, vi } from "vitest";
import { ReviewTracker } from "./plannotator";

describe("review tracker", () => {
  it("allows one review and emits matching lifecycle messages", () => {
    const emit = vi.fn();
    const tracker = new ReviewTracker("http://localhost:19432", emit);
    tracker.start("session-1", "plan", "review-1");
    expect(() => tracker.start("session-2", "code", "review-2")).toThrow(/already active/);
    tracker.finish("session-1", { approved: true });
    expect(emit.mock.calls.map((call) => call[0])).toEqual([
      { type: "review_started", sessionId: "session-1", reviewId: "review-1", kind: "plan", url: "http://localhost:19432" },
      { type: "review_finished", sessionId: "session-1", reviewId: "review-1", kind: "plan", approved: true },
    ]);
  });
});
