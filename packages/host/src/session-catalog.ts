import { createHash } from "node:crypto";
import { basename } from "node:path";
import type { SessionInfo } from "@earendil-works/pi-coding-agent";
import type { SessionItem } from "@pi-remote/protocol";

export type CatalogRecord = { item: SessionItem; path: string };

export function sessionCatalogId(path: string): string {
  return createHash("sha256").update(path).digest("hex").slice(0, 24);
}

export function buildSessionCatalog(
  sessions: SessionInfo[],
  activePath: string | null,
  state: { running: boolean; reviewing: boolean },
): CatalogRecord[] {
  return sessions.map((session) => {
    const active = session.path === activePath;
    const fallback = session.firstMessage.trim().replace(/\s+/g, " ").slice(0, 80) || "Untitled session";
    return {
      path: session.path,
      item: {
        id: sessionCatalogId(session.path),
        name: session.name?.trim() || fallback,
        cwd: session.cwd,
        project: basename(session.cwd) || session.cwd || "Unknown project",
        createdAt: session.created.toISOString(),
        modifiedAt: session.modified.toISOString(),
        messageCount: session.messageCount,
        firstMessage: session.firstMessage,
        active,
        running: active && state.running,
        reviewing: active && state.reviewing,
      },
    };
  });
}

export function resolveCatalogSession(records: CatalogRecord[], id: string): CatalogRecord | null {
  return records.find((record) => record.item.id === id) ?? null;
}

export function assertSessionSwitchAllowed(state: { running: boolean; reviewing: boolean }): void {
  if (state.running) throw new Error("Stop the running agent before switching sessions.");
  if (state.reviewing) throw new Error("Finish the active Plannotator review before switching sessions.");
}
