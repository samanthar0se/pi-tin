import { PROTOCOL_VERSION, type ServerMessage } from "@pi-tin/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import type { HostBackend } from "./types";
import { HostWebSocketServer } from "./websocket-server";

const servers: HostWebSocketServer[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  for (const server of servers.splice(0)) await server.stop();
});

describe("host WebSocket initial sync", () => {
  it("delivers events raised during the initial snapshot after the baseline", async () => {
    const gate = deferred<ServerMessage[]>();
    let emit: ((message: ServerMessage) => void) | undefined;
    const backend: HostBackend = {
      authenticate: (token) => token === "secret",
      initialMessages: vi.fn(() => gate.promise),
      handle: vi.fn(async () => ({})),
      subscribe: (listener) => { emit = listener; return () => { emit = undefined; }; },
    };
    const server = new HostWebSocketServer(backend, "127.0.0.1", 0);
    servers.push(server);
    await server.start();
    const port = ((server as unknown as { http: { address(): { port: number } } }).http.address()).port;
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    sockets.push(socket);
    const received: ServerMessage[] = [];
    socket.on("message", (bytes) => received.push(JSON.parse(bytes.toString())));
    await new Promise<void>((resolve) => socket.once("open", () => resolve()));

    socket.send(JSON.stringify({ type: "auth", version: PROTOCOL_VERSION, token: "secret" }));
    await vi.waitFor(() => expect(backend.initialMessages).toHaveBeenCalledOnce());
    emit?.({ type: "review_finished", sessionId: "session-1", reviewId: "review-1", kind: "plan", approved: true });
    expect(received).toEqual([]);

    gate.resolve([
      { type: "session_list", version: PROTOCOL_VERSION, sessions: [], maxSessions: 5 },
      { type: "host_state", sessionId: "session-1", rpcStatus: "ready", activeReviewId: "review-1" },
    ]);
    await vi.waitFor(() => expect(received).toHaveLength(3));
    expect(received.map((message) => message.type)).toEqual(["session_list", "host_state", "review_finished"]);
  });

  it("closes an initial sync whose buffered event stream exceeds its safety bound", async () => {
    const gate = deferred<ServerMessage[]>();
    let emit: ((message: ServerMessage) => void) | undefined;
    const backend: HostBackend = {
      authenticate: () => true,
      initialMessages: vi.fn(() => gate.promise),
      handle: vi.fn(async () => ({})),
      subscribe: (listener) => { emit = listener; return () => { emit = undefined; }; },
    };
    const server = new HostWebSocketServer(backend, "127.0.0.1", 0);
    servers.push(server);
    await server.start();
    const port = ((server as unknown as { http: { address(): { port: number } } }).http.address()).port;
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    sockets.push(socket);
    await new Promise<void>((resolve) => socket.once("open", () => resolve()));
    socket.send(JSON.stringify({ type: "auth", version: PROTOCOL_VERSION, token: "secret" }));
    await vi.waitFor(() => expect(backend.initialMessages).toHaveBeenCalledOnce());

    const closed = new Promise<number>((resolve) => socket.once("close", (code) => resolve(code)));
    for (let index = 0; index <= 512; index += 1) {
      emit?.({ type: "error", code: "busy", message: `Queued event ${index}` });
    }
    await expect(closed).resolves.toBe(1013);
    gate.resolve([]);
  });
});

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
