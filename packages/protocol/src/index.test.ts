import { describe, expect, it } from "vitest";
import { clientMessageSchema, parseServerMessage, PROTOCOL_VERSION } from "./index";

describe("protocol v3 validation", () => {
  it("accepts auth and request-ID commands", () => {
    expect(clientMessageSchema.parse({ type: "auth", version: PROTOCOL_VERSION, token: "secret" }).type).toBe("auth");
    expect(clientMessageSchema.parse({ type: "prompt", id: "r1", message: "hello" }).type).toBe("prompt");
    expect(clientMessageSchema.parse({ type: "restart_pi", id: "r2" }).type).toBe("restart_pi");
  });
  it("rejects malformed and unknown messages", () => {
    expect(clientMessageSchema.safeParse({ type: "abort" }).success).toBe(false);
    expect(clientMessageSchema.safeParse({ type: "shell", id: "r1", command: "rm -rf /" }).success).toBe(false);
    expect(clientMessageSchema.safeParse({ type: "switch_session", id: "r2", sessionId: "opaque" }).success).toBe(false);
    expect(() => parseServerMessage({ type: "snapshot", version: 99 })).toThrow();
  });
});
