import { describe, expect, it } from "vitest";
import { clientMessageSchema, parseServerMessage, PROTOCOL_VERSION } from "./index";

describe("protocol validation", () => {
  it("accepts auth and request-ID commands", () => {
    expect(clientMessageSchema.parse({ type: "auth", version: PROTOCOL_VERSION, token: "secret" }).type).toBe("auth");
    expect(clientMessageSchema.parse({ type: "create_session", id: "r0", cwd: "/work/project" }).type).toBe("create_session");
    expect(clientMessageSchema.parse({ type: "prompt", id: "r1", sessionId: "s1", message: "hello" }).type).toBe("prompt");
    expect(clientMessageSchema.parse({ type: "restart_pi", id: "r2", sessionId: "s1" }).type).toBe("restart_pi");
    expect(clientMessageSchema.parse({ type: "new_session", id: "r3", sessionId: "s1" }).type).toBe("new_session");
    expect(clientMessageSchema.parse({ type: "extension_ui_response", id: "r4", sessionId: "s1", uiRequestId: "ui-1", value: "Option A" }).type).toBe("extension_ui_response");
    expect(parseServerMessage({ type: "extension_ui_request", sessionId: "s1", id: "ui-1", method: "select", title: "Choose", options: ["Option A"] }).type).toBe("extension_ui_request");
  });
  it("rejects malformed and unknown messages", () => {
    expect(clientMessageSchema.safeParse({ type: "abort" }).success).toBe(false);
    expect(clientMessageSchema.safeParse({ type: "shell", id: "r1", command: "rm -rf /" }).success).toBe(false);
    expect(clientMessageSchema.safeParse({ type: "prompt", id: "r2", message: "missing routing" }).success).toBe(false);
    expect(clientMessageSchema.safeParse({ type: "switch_session", id: "r3", sessionId: "opaque" }).success).toBe(false);
    expect(() => parseServerMessage({ type: "snapshot", version: 99 })).toThrow();
  });
});
