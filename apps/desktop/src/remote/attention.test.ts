import { describe, expect, it } from "vitest";
import { nextEventAttention, visibleSessionAttention } from "./attention";

describe("session attention", () => {
  it("keeps a background failure when the run subsequently settles", () => {
    const failed = nextEventAttention({
      previous: null,
      isActive: false,
      wasRunning: true,
      isRunning: true,
      event: { type: "message_end", message: { stopReason: "error" } },
    });
    expect(nextEventAttention({
      previous: failed,
      isActive: false,
      wasRunning: true,
      isRunning: false,
      event: { type: "agent_settled" },
    })).toBe("failed");
  });

  it("keeps unanswered input visible even after its tab has been visited", () => {
    expect(visibleSessionAttention({ stored: null, hasPendingInput: true, hasReview: false })).toBe("needs-input");
  });
});
