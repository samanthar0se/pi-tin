export type SessionAttention = "completed" | "needs-input" | "review" | "failed" | null;

type AttentionEvent = {
  type?: string;
  message?: { stopReason?: string };
  isError?: boolean;
};

export function nextEventAttention(options: {
  previous: SessionAttention;
  isActive: boolean;
  wasRunning: boolean;
  isRunning: boolean;
  event: AttentionEvent;
}): SessionAttention {
  if (options.isActive) return null;
  const failed = (options.event.type === "message_end" && options.event.message?.stopReason === "error")
    || (options.event.type === "tool_execution_end" && options.event.isError === true);
  if (failed) return "failed";
  if (options.event.type === "agent_start") return null;
  if (options.wasRunning && !options.isRunning) return options.previous === "failed" ? "failed" : "completed";
  return options.previous;
}

export function visibleSessionAttention(options: {
  stored: SessionAttention;
  hasPendingInput: boolean;
  hasReview: boolean;
}): SessionAttention {
  if (options.hasPendingInput) return "needs-input";
  return options.stored || (options.hasReview ? "review" : null);
}
