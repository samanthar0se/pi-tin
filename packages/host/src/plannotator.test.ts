import { afterEach, describe, expect, it, vi } from "vitest";
import { ReviewTracker } from "./plannotator";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

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

  it("bounds how long it waits for the review server to start", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
    const emit = vi.fn();
    const tracker = new ReviewTracker("http://localhost:19432", emit);
    tracker.start("session-1", "code", "review-1");

    const watching = tracker.watchCodeReview("session-1", 19432, 2_000);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(tracker.active).not.toBeNull();

    await vi.advanceTimersByTimeAsync(1);
    await watching;
    expect(tracker.active).toBeNull();
    expect(emit).toHaveBeenLastCalledWith({
      type: "review_finished",
      sessionId: "session-1",
      reviewId: "review-1",
      kind: "code",
      error: "Plannotator did not open its review server.",
    });
  });

  it("keeps monitoring a review for several minutes before the server disappears", async () => {
    vi.useFakeTimers();
    let reachable = true;
    const fetchMock = vi.fn(async () => ({ ok: reachable }));
    vi.stubGlobal("fetch", fetchMock);
    const emit = vi.fn();
    const tracker = new ReviewTracker("http://localhost:19432", emit);
    tracker.start("session-1", "code", "review-1");

    const watching = tracker.watchCodeReview("session-1", 19432);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(tracker.active).toEqual({ id: "review-1", sessionId: "session-1", kind: "code" });

    reachable = false;
    await vi.advanceTimersByTimeAsync(1_300);
    await watching;
    expect(fetchMock.mock.calls.length).toBeGreaterThan(2);
    expect(tracker.active).toBeNull();
    expect(emit).toHaveBeenLastCalledWith({
      type: "review_finished",
      sessionId: "session-1",
      reviewId: "review-1",
      kind: "code",
    });
  });

  it("stops monitoring when the review lifecycle ends elsewhere", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const tracker = new ReviewTracker("http://localhost:19432", vi.fn());
    tracker.start("session-1", "code", "review-1");

    const watching = tracker.watchCodeReview("session-1", 19432);
    await vi.advanceTimersByTimeAsync(0);
    tracker.finish("session-1");
    await vi.advanceTimersByTimeAsync(650);
    await watching;

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("cancels a live watcher when the tracker is disposed", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true })));
    const tracker = new ReviewTracker("http://localhost:19432", vi.fn());
    tracker.start("session-1", "code", "review-1");

    const watching = tracker.watchCodeReview("session-1", 19432);
    await vi.advanceTimersByTimeAsync(0);
    tracker.dispose();
    await watching;

    expect(tracker.active).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
