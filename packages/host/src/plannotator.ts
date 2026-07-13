import { randomUUID } from "node:crypto";
import type { ReviewFinished, ReviewStarted } from "@pi-remote/protocol";

export class ReviewTracker {
  active: { id: string; kind: "plan" | "code" } | null = null;
  constructor(private url: string, private emit: (message: ReviewStarted | ReviewFinished) => void) {}

  start(kind: "plan" | "code", id: string = randomUUID()): string {
    if (this.active) throw new Error("A Plannotator review is already active.");
    this.active = { id, kind };
    this.emit({ type: "review_started", reviewId: id, kind, url: this.url });
    return id;
  }

  finish(options: { approved?: boolean; error?: string } = {}): void {
    if (!this.active) return;
    const review = this.active;
    this.active = null;
    this.emit({ type: "review_finished", reviewId: review.id, kind: review.kind, ...options });
  }

  async watchCodeReview(port: number, timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let appeared = false;
    let misses = 0;
    while (Date.now() < deadline && this.active?.kind === "code") {
      let reachable = false;
      try {
        const response = await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(800) });
        reachable = response.ok;
      } catch {}
      if (reachable) { appeared = true; misses = 0; }
      else if (appeared && ++misses >= 2) { this.finish(); return; }
      await new Promise((resolve) => setTimeout(resolve, 650));
    }
    if (!appeared && this.active?.kind === "code") this.finish({ error: "Plannotator did not open its review server." });
  }
}
