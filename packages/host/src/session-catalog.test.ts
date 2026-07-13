import { describe, expect, it } from "vitest";
import { assertSessionSwitchAllowed, buildSessionCatalog, resolveCatalogSession } from "./session-catalog";

describe("session catalog", () => {
  it("uses opaque IDs and rejects paths not present in the catalog", () => {
    const records = buildSessionCatalog([{
      path: "/sessions/a.jsonl", id: "a", cwd: "/work/demo", name: "Feature work",
      created: new Date("2026-01-01"), modified: new Date("2026-01-02"), messageCount: 4,
      firstMessage: "Build it", allMessagesText: "Build it", parentSessionPath: undefined,
    }], "/sessions/a.jsonl", { running: true, reviewing: false });
    expect(records[0]?.item).toMatchObject({ name: "Feature work", project: "demo", active: true, running: true });
    expect(resolveCatalogSession(records, records[0]!.item.id)?.path).toBe("/sessions/a.jsonl");
    expect(resolveCatalogSession(records, "/sessions/a.jsonl")).toBeNull();
  });

  it("blocks switching during agent work or review", () => {
    expect(() => assertSessionSwitchAllowed({ running: true, reviewing: false })).toThrow(/running agent/);
    expect(() => assertSessionSwitchAllowed({ running: false, reviewing: true })).toThrow(/Plannotator/);
    expect(() => assertSessionSwitchAllowed({ running: false, reviewing: false })).not.toThrow();
  });
});
