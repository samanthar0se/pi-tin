import { useEffect, useMemo, useRef, type ReactNode } from "react";
import {
  AssistantRuntimeProvider,
  SimpleImageAttachmentAdapter,
  useExternalStoreRuntime,
  type AppendMessage,
  type AttachmentAdapter,
  type ThreadMessage,
} from "@assistant-ui/react";
import type { ImageInput } from "@pi-tin/protocol";
import { toast } from "sonner";
import { useAppStore } from "../remote/store";
import { parseClientSlashCommand } from "./client-slash-commands";
import { createRuntimeMessageRepository } from "./runtime-message-repository";
import { mergeSubmittedDraft } from "./session-draft";

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

function sameFiles(left: File[], right: File[]): boolean {
  return left.length === right.length && left.every((file, index) => file === right[index]);
}

function messageText(message: AppendMessage): string {
  return message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
}

function messageFiles(message: AppendMessage): File[] {
  return (message.attachments ?? []).flatMap((attachment) => attachment.file ? [attachment.file] : []);
}

export function PiRuntimeProvider({ children, sessionId }: { children: ReactNode; sessionId: string }) {
  const messages = useAppStore((state) => state.session.messages);
  const isRunning = useAppStore((state) => state.session.isRunning);
  const connectionState = useAppStore((state) => state.connectionState);
  const rpcStatus = useAppStore((state) => state.rpcStatus);
  const command = useAppStore((state) => state.command);
  const updateSessionDraft = useAppStore((state) => state.updateSessionDraft);
  const messageRepository = useMemo(() => createRuntimeMessageRepository(messages), [messages]);
  const restoredFiles = useRef(new Set<File>());
  const restoreSubmittedDraft = useRef<(text: string, files: File[]) => Promise<void>>(async () => {});

  const runtime = useExternalStoreRuntime<ThreadMessage>({
    messageRepository,
    isRunning,
    adapters: { attachments: imageAttachmentAdapter },
    onNew: async (message: AppendMessage) => {
      const submittedText = messageText(message);
      const submittedFiles = messageFiles(message);
      try {
        if (connectionState !== "connected") throw new Error("Connect to a Pi instance before sending.");
        if (rpcStatus !== "ready") throw new Error(rpcStatus === "starting" ? "Pi is still starting." : "Restart this Pi runtime before sending.");
        const text = submittedText.trim();
        const images = messageImages(message);
        if (!text && images.length === 0) return;
        const clientCommand = parseClientSlashCommand(text, images.length > 0);
        if (clientCommand) {
          await command(clientCommand, clientCommand.type === "compact" ? 120_000 : 30_000);
          return;
        }
        await command({ type: isRunning ? "steer" : "prompt", message: text, images: images.length ? images : undefined });
      } catch (error) {
        await restoreSubmittedDraft.current(submittedText, submittedFiles);
        const detail = error instanceof Error ? error.message : "The host did not confirm this message.";
        toast.error(`${detail} Your draft was restored.`);
      }
    },
    onCancel: async () => {
      if (connectionState !== "connected" || rpcStatus !== "ready") return;
      await command({ type: "abort" });
    },
  });

  restoreSubmittedDraft.current = async (submittedText, submittedFiles) => {
    const composer = runtime.thread.composer;
    const state = composer.getState();
    const currentFiles = state.attachments.flatMap((attachment) => attachment.file ? [attachment.file] : []);
    const merged = mergeSubmittedDraft(state.text, currentFiles, submittedText, submittedFiles);
    composer.setText(merged.text);
    for (const file of merged.files) {
      if (currentFiles.includes(file)) continue;
      try { await composer.addAttachment(file); }
      catch (error) { toast.error(error instanceof Error ? error.message : `Could not restore ${file.name}`); }
    }
    updateSessionDraft(sessionId, (draft) => {
      const recovered = mergeSubmittedDraft(draft.idleText, draft.idleImageFiles, submittedText, submittedFiles);
      if (draft.idleText === recovered.text && sameFiles(draft.idleImageFiles, recovered.files)) return draft;
      return { ...draft, idleText: recovered.text, idleImageFiles: recovered.files };
    });
  };

  useEffect(() => {
    const composer = runtime.thread.composer;
    const initialDraft = useAppStore.getState().sessionViews[sessionId]?.draft;
    if (!initialDraft) return;
    let disposed = false;
    let hydrated = false;

    const snapshot = (preserveInitialFiles = false) => {
      const state = composer.getState();
      const currentFiles = state.attachments.flatMap((attachment) => attachment.file ? [attachment.file] : []);
      const files = preserveInitialFiles
        ? [...currentFiles, ...initialDraft.idleImageFiles.filter((file) => !currentFiles.includes(file))]
        : currentFiles;
      updateSessionDraft(sessionId, (draft) => {
        if (draft.idleText === state.text && sameFiles(draft.idleImageFiles, files)) return draft;
        return { ...draft, idleText: state.text, idleImageFiles: files };
      });
    };

    composer.setText(initialDraft.idleText);
    const unsubscribe = composer.subscribe(() => {
      if (hydrated && !disposed) snapshot();
    });
    const existingFiles = composer.getState().attachments.flatMap((attachment) => attachment.file ? [attachment.file] : []);
    const filesToRestore = initialDraft.idleImageFiles.filter((file) => !existingFiles.includes(file) && !restoredFiles.current.has(file));
    for (const file of filesToRestore) restoredFiles.current.add(file);
    void Promise.all(filesToRestore.map(async (file) => {
      try { await composer.addAttachment(file); }
      catch (error) {
        restoredFiles.current.delete(file);
        toast.error(error instanceof Error ? error.message : `Could not restore ${file.name}`);
      }
    })).then(() => {
      if (disposed) return;
      hydrated = true;
      snapshot();
    });

    return () => {
      snapshot(!hydrated);
      disposed = true;
      unsubscribe();
    };
  }, [runtime, sessionId, updateSessionDraft]);

  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}
