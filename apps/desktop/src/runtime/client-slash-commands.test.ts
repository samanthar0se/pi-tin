import { describe, expect, it } from "vitest";
import { parseClientSlashCommand } from "./client-slash-commands";

describe("parseClientSlashCommand", () => {
  it("maps local session commands to real RPC commands", () => {
    expect(parseClientSlashCommand("/new", false)).toEqual({ type: "new_session" });
    expect(parseClientSlashCommand(" /compact ", false)).toEqual({ type: "compact" });
    expect(parseClientSlashCommand("/compact preserve recent errors", false)).toEqual({
      type: "compact",
      customInstructions: "preserve recent errors",
    });
  });

  it("leaves image and unknown slash prompts for Pi", () => {
    expect(parseClientSlashCommand("/compact", true)).toBeNull();
    expect(parseClientSlashCommand("/review", false)).toBeNull();
  });
});
