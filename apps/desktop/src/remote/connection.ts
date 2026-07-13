import { PROTOCOL_VERSION, parseServerMessage, type ClientCommand, type ClientCommandInput, type ServerMessage } from "@pi-remote/protocol";

export type HostProfile = {
  id: string;
  name: string;
  host: string;
  controlPort: number;
  plannotatorPort: number;
  token: string;
};

type ConnectionHooks = {
  onState: (state: "connecting" | "connected" | "offline" | "error", detail?: string) => void;
  onMessage: (message: ServerMessage) => void;
};

type SocketLike = Pick<WebSocket, "readyState" | "send" | "close"> & {
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
};

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };

export class PiConnection {
  private socket: SocketLike | null = null;
  private profile: HostProfile | null = null;
  private stopped = true;
  private generation = 0;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pending = new Map<string, Pending>();

  constructor(private hooks: ConnectionHooks, private socketFactory: (url: string) => SocketLike = (url) => new WebSocket(url)) {}

  connect(profile: HostProfile): void {
    this.disconnect();
    this.profile = profile;
    this.stopped = false;
    this.reconnectAttempt = 0;
    this.open();
  }

  disconnect(): void {
    this.stopped = true;
    this.generation++;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.socket?.close(1000, "Switching instance");
    this.socket = null;
    this.rejectPending("Disconnected");
  }

  async command(command: ClientCommandInput, timeoutMs = 15_000): Promise<unknown> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new Error("Not connected");
    const id = crypto.randomUUID();
    const payload = { ...command, id } as ClientCommand;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${command.type} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket!.send(JSON.stringify(payload));
    });
  }

  private open(): void {
    if (!this.profile || this.stopped) return;
    const generation = ++this.generation;
    this.hooks.onState("connecting");
    const socket = this.socketFactory(`ws://${this.profile.host}:${this.profile.controlPort}`);
    this.socket = socket;
    socket.onopen = () => {
      if (generation !== this.generation || !this.profile) return;
      socket.send(JSON.stringify({ type: "auth", version: PROTOCOL_VERSION, token: this.profile.token }));
    };
    socket.onmessage = (event) => {
      if (generation !== this.generation) return;
      try {
        const message = parseServerMessage(JSON.parse(String(event.data)));
        if (message.type === "snapshot") {
          this.reconnectAttempt = 0;
          this.hooks.onState("connected");
        }
        if (message.type === "response") {
          const pending = this.pending.get(message.id);
          if (pending) {
            clearTimeout(pending.timer);
            this.pending.delete(message.id);
            message.success ? pending.resolve(message.data) : pending.reject(new Error(message.error || `${message.command} failed`));
          }
        }
        if (message.type === "error" && message.code === "unauthorized") this.hooks.onState("error", message.message);
        this.hooks.onMessage(message);
      } catch (error) {
        this.hooks.onState("error", error instanceof Error ? error.message : "Invalid server message");
      }
    };
    socket.onerror = () => {
      if (generation === this.generation) this.hooks.onState("error", "WebSocket connection failed");
    };
    socket.onclose = (event) => {
      if (generation !== this.generation) return;
      this.socket = null;
      this.rejectPending("Connection closed");
      if (this.stopped || event.code === 4003) {
        this.hooks.onState(event.code === 4003 ? "error" : "offline", event.reason || undefined);
        return;
      }
      this.hooks.onState("offline", "Reconnecting…");
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    const delay = Math.min(10_000, 500 * 2 ** this.reconnectAttempt++);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  private rejectPending(reason: string): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    this.pending.clear();
  }
}
