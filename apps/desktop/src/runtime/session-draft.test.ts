import { describe, expect, it } from "vitest";
import { mergeSubmittedDraft } from "./session-draft";

describe("session draft recovery", () => {
  it("restores a failed submission without overwriting text typed afterward", () => {
    const submittedFile = { name: "submitted.png" } as File;
    const newerFile = { name: "newer.png" } as File;

    expect(mergeSubmittedDraft("new thought", [newerFile], "original request", [submittedFile])).toEqual({
      text: "original request\n\nnew thought",
      files: [submittedFile, newerFile],
    });
  });

  it("does not duplicate a submission the composer already restored", () => {
    const file = { name: "image.png" } as File;
    expect(mergeSubmittedDraft("request", [file], "request", [file])).toEqual({ text: "request", files: [file] });
    expect(mergeSubmittedDraft("request\n\nnew thought", [file], "request", [file])).toEqual({ text: "request\n\nnew thought", files: [file] });
  });
});
