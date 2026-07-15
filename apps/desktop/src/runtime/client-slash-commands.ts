import type { SessionCommandInput } from "@pi-tin/protocol";

export type ClientSlashCommand = {
  name: "new" | "compact";
  description: string;
  source: "client";
  scope: "temporary";
};

export const clientSlashCommands: ClientSlashCommand[] = [
  { name: "new", description: "Start a fresh persistent session", source: "client", scope: "temporary" },
  { name: "compact", description: "Compact the current session context", source: "client", scope: "temporary" },
];

export function parseClientSlashCommand(text: string, hasImages: boolean): SessionCommandInput | null {
  if (hasImages) return null;
  const trimmed = text.trim();
  if (trimmed === "/new") return { type: "new_session" };
  if (trimmed === "/compact") return { type: "compact" };
  if (trimmed.startsWith("/compact ")) {
    const customInstructions = trimmed.slice("/compact ".length).trim();
    return customInstructions ? { type: "compact", customInstructions } : { type: "compact" };
  }
  return null;
}
