import type { ReactNode } from "react";
import {
  AssistantRuntimeProvider,
  SimpleImageAttachmentAdapter,
  useExternalStoreRuntime,
  type AppendMessage,
  type AttachmentAdapter,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import type { ImageInput } from "@pi-tin/protocol";
import { useAppStore } from "../remote/store";
import { parseClientSlashCommand } from "./client-slash-commands";

const simpleImageAdapter = new SimpleImageAttachmentAdapter();
const imageAttachmentAdapter: AttachmentAdapter = {
  accept: "image/png,image/jpeg,image/gif,image/webp",
  async add({ file }) {
    if (file.size > 3_538_944) throw new Error("Images must be smaller than 3.4 MB.");
    return simpleImageAdapter.add({ file });
  },
  send: (attachment) => simpleImageAdapter.send(attachment),
  remove: () => simpleImageAdapter.remove(),
};

function imageInput(part: { type?: string; image?: string }): ImageInput | null {
  if (part.type !== "image" || typeof part.image !== "string") return null;
  const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,(.+)$/s.exec(part.image);
  return match ? { type: "image", mimeType: match[1] as ImageInput["mimeType"], data: match[2]! } : null;
}

function messageImages(message: AppendMessage): ImageInput[] {
  return [
    ...message.content,
    ...(message.attachments ?? []).flatMap((attachment) => attachment.content),
  ].map(imageInput).filter((image): image is ImageInput => image !== null);
}

export function PiRuntimeProvider({ children }: { children: ReactNode }) {
  const messages = useAppStore((state) => state.session.messages);
  const isRunning = useAppStore((state) => state.session.isRunning);
  const connectionState = useAppStore((state) => state.connectionState);
  const command = useAppStore((state) => state.command);

  const runtime = useExternalStoreRuntime({
    messages,
    isRunning,
    convertMessage: (message): ThreadMessageLike => message,
    adapters: { attachments: imageAttachmentAdapter },
    onNew: async (message: AppendMessage) => {
      if (connectionState !== "connected") throw new Error("Connect to a Pi instance before sending.");
      const text = message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n").trim();
      const images = messageImages(message);
      if (!text && images.length === 0) return;
      const clientCommand = parseClientSlashCommand(text, images.length > 0);
      if (clientCommand) {
        await command(clientCommand, clientCommand.type === "compact" ? 120_000 : 30_000);
        return;
      }
      await command({ type: isRunning ? "steer" : "prompt", message: text, images: images.length ? images : undefined });
    },
    onCancel: async () => { await command({ type: "abort" }); },
  });

  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}
