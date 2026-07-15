import type { ImageInput } from "@pi-tin/protocol";

export type GuidanceDelivery = "steer" | "follow_up";

export type GuidanceImageDraft = ImageInput & {
  id: string;
  name: string;
  preview: string;
};

export type SessionDraft = {
  idleText: string;
  idleImageFiles: File[];
  guidanceText: string;
  guidanceImages: GuidanceImageDraft[];
  guidanceDelivery: GuidanceDelivery;
};

export function createEmptySessionDraft(): SessionDraft {
  return {
    idleText: "",
    idleImageFiles: [],
    guidanceText: "",
    guidanceImages: [],
    guidanceDelivery: "steer",
  };
}

export function mergeSubmittedDraft(
  currentText: string,
  currentFiles: File[],
  submittedText: string,
  submittedFiles: File[],
): { text: string; files: File[] } {
  const alreadyRestored = currentText === submittedText || currentText.startsWith(`${submittedText}\n\n`);
  const text = !submittedText ? currentText
    : !currentText || alreadyRestored ? currentText || submittedText
    : `${submittedText}\n\n${currentText}`;
  const files = [...submittedFiles, ...currentFiles.filter((file) => !submittedFiles.includes(file))];
  return { text, files };
}
