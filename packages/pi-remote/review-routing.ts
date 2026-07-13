import type { ReviewFinished, ReviewStarted } from "@pi-remote/protocol";

export const PLAN_TOOL_NAME = "plannotator_submit_plan";

export function routePlanReviewEvent(
  event: any,
  active: Map<string, string>,
  url: string,
): { message: ReviewStarted | ReviewFinished; phase: "planning" | "executing" | "reviewing" } | null {
  if (event?.type === "tool_execution_start" && event.toolName === PLAN_TOOL_NAME) {
    const reviewId = String(event.toolCallId);
    active.set(reviewId, reviewId);
    return { message: { type: "review_started", reviewId, kind: "plan", url }, phase: "reviewing" };
  }
  if (event?.type === "tool_execution_end" && event.toolName === PLAN_TOOL_NAME) {
    const key = String(event.toolCallId);
    const reviewId = active.get(key) || key;
    active.delete(key);
    const approved = Boolean(event.result?.details?.approved);
    return {
      message: {
        type: "review_finished", reviewId, kind: "plan", approved,
        ...(event.isError ? { error: extractResultText(event.result) || "Plan review failed." } : {}),
      },
      phase: approved ? "executing" : "planning",
    };
  }
  return null;
}

export function codeReviewFollowUp(result: { approved?: boolean; feedback?: string }): string | null {
  if (result.approved) return "The code review was approved. Continue with the current task.";
  if (result.feedback) return `Code review feedback:\n\n${result.feedback}\n\nAddress the valid findings, then summarize what changed.`;
  return null;
}

function extractResultText(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return "";
  return content.filter((part: any) => part?.type === "text").map((part: any) => String(part.text || "")).join("\n");
}
