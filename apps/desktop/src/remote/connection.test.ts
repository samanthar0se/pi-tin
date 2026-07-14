import { describe, expect, it, vi } from "vitest";
import { PROTOCOL_VERSION } from "@pi-tin/protocol";
import { PiConnection } from "./connection";

class FakeSocket {
  static OPEN = 1;
  readyState = 1;
  sent: string[] = [];
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  send(value: string) { this.sent.push(value); }
  close() {}
}

describe("connection auth boundary", () => {
  it("authenticates before commands and correlates responses", async () => {
    (globalThis as any).WebSocket = FakeSocket;
    const socket = new FakeSocket();
    const states: string[] = [];
    const connection = new PiConnection({ onState: (state) => states.push(state), onMessage: vi.fn() }, () => socket as any);
    connection.connect({ host: "10.0.0.2", controlPort: 31415, plannotatorPort: 19432, token: "token" });
    socket.onopen!(new Event("open"));
    expect(JSON.parse(socket.sent[0]!)).toMatchObject({ type: "auth", token: "token" });
    socket.onmessage!({ data: JSON.stringify({ type: "session_list", version: PROTOCOL_VERSION, sessions: [], maxSessions: 5 }) } as MessageEvent);
    const pending = connection.command({ type: "abort", sessionId: "s1" });
    const command = JSON.parse(socket.sent[1]!);
    socket.onmessage!({ data: JSON.stringify({ type: "response", id: command.id, command: "abort", success: true }) } as MessageEvent);
    await expect(pending).resolves.toBeUndefined();
    expect(states).toContain("connected");
    connection.disconnect();
  });
});
