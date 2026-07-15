import { randomUUID } from "node:crypto";
import type { ReviewFinished, ReviewStarted } from "@pi-tin/protocol";

export class ReviewTracker {
  active: { id: string; sessionId: string; kind: "plan" | "code" } | null = null;
  private watchAbort: AbortController | null = null;
  constructor(private url: string, private emit: (message: ReviewStarted | ReviewFinished) => void) {}

  start(sessionId: string, kind: "plan" | "code", id: string = randomUUID()): string {
    if (this.active) throw new Error("A Plannotator review is already active.");
    this.active = { id, sessionId, kind };
    this.emit({ type: "review_started", sessionId, reviewId: id, kind, url: this.url });
    return id;
  }

  currentStartMessage(sessionId: string): ReviewStarted | null {
    const review = this.active;
    if (!review || review.sessionId !== sessionId) return null;
    return { type: "review_started", sessionId, reviewId: review.id, kind: review.kind, url: this.url };
  }

  finish(sessionId: string, options: { approved?: boolean; error?: string } = {}): void {
    if (!this.active) return;
    if (this.active.sessionId !== sessionId) return;
    const review = this.active;
    this.active = null;
    this.watchAbort?.abort();
    this.watchAbort = null;
    this.emit({ type: "review_finished", sessionId, reviewId: review.id, kind: review.kind, ...options });
  }

  dispose(): void {
    this.active = null;
    this.watchAbort?.abort();
    this.watchAbort = null;
  }

  async watchCodeReview(sessionId: string, port: number, startupTimeoutMs = 30_000): Promise<void> {
    const review = this.active;
    if (review?.sessionId !== sessionId || review.kind !== "code") return;
    this.watchAbort?.abort();
    const watchAbort = new AbortController();
    this.watchAbort = watchAbort;

    const isActive = () => this.active === review && !watchAbort.signal.aborted;
    const probe = async () => {
      try {
        const response = await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(800) });
        return response.ok;
      } catch {
        return false;
      }
    };
    const wait = (durationMs: number) => new Promise<void>((resolve) => {
      let timer: ReturnType<typeof setTimeout>;
      const done = () => {
        clearTimeout(timer);
        watchAbort.signal.removeEventListener("abort", done);
        resolve();
      };
      timer = setTimeout(done, durationMs);
      watchAbort.signal.addEventListener("abort", done, { once: true });
      if (watchAbort.signal.aborted) done();
    });

    const startupDeadline = Date.now() + startupTimeoutMs;
    let appeared = false;
    while (Date.now() < startupDeadline && isActive()) {
      appeared = await probe();
      if (appeared) break;
      const remainingMs = startupDeadline - Date.now();
      if (remainingMs > 0) await wait(Math.min(650, remainingMs));
    }

    if (!isActive()) return;
    if (!appeared) {
      this.finish(sessionId, { error: "Plannotator did not open its review server." });
      return;
    }

    let misses = 0;
    while (isActive()) {
      await wait(650);
      if (!isActive()) return;
      const reachable = await probe();
      if (!isActive()) return;
      if (reachable) misses = 0;
      else if (++misses >= 2) { this.finish(sessionId); return; }
    }
  }
}
