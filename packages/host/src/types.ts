import type { ClientCommand, ServerMessage } from "@pi-tin/protocol";

export interface HostBackend {
  authenticate(token: string): boolean;
  initialMessages(): Promise<ServerMessage[]>;
  handle(command: ClientCommand): Promise<{ data?: unknown }>;
  subscribe(listener: (message: ServerMessage) => void): () => void;
}
