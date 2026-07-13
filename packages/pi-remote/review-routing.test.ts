import { describe, expect, it, vi } from "vitest";
import { codeReviewFollowUp, routePlanReviewEvent } from "./review-routing";
import { tokensEqual } from "./index";

describe("server authentication", () => {
  it("requires a non-empty exact token", () => {
    expect(tokensEqual("secret", "secret")).toBe(true);
    expect(tokensEqual("secret", "wrong")).toBe(false);
    expect(tokensEqual("", "")).toBe(false);
  });
});

describe("Plannotator routing", () => {
  it("routes matching plan start and finish events", () => {
    const active = new Map<string, string>();
    const start = routePlanReviewEvent({ type: "tool_execution_start", toolName: "plannotator_submit_plan", toolCallId: "plan-1" }, active, "http://host:19432");
    expect(start?.message.type).toBe("review_started");
    expect(start?.phase).toBe("reviewing");
    const finish = routePlanReviewEvent({ type: "tool_execution_end", toolName: "plannotator_submit_plan", toolCallId: "plan-1", result: { details: { approved: true } } }, active, "http://host:19432");
    expect(finish?.message).toMatchObject({ type: "review_finished", reviewId: "plan-1", approved: true });
    expect(finish?.phase).toBe("executing");
  });

  it("turns code review results into Pi follow-ups", () => {
    const pi = { sendUserMessage: vi.fn() };
    const message = codeReviewFollowUp({ approved: false, feedback: "Fix the race." });
    if (message) pi.sendUserMessage(message, { deliverAs: "followUp" });
    expect(pi.sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("Fix the race."), { deliverAs: "followUp" });
    expect(codeReviewFollowUp({})).toBeNull();
  });
});
