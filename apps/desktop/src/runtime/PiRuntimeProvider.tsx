import type { ReactNode } from "react";
import { AssistantRuntimeProvider, useExternalStoreRuntime, type AppendMessage, type ThreadMessageLike } from "@assistant-ui/react";
import { useAppStore } from "../remote/store";

export function PiRuntimeProvider({ children }: { children: ReactNode }) {
  const messages = useAppStore((state) => state.session.messages);
  const isRunning = useAppStore((state) => state.session.isRunning);
  const connectionState = useAppStore((state) => state.connectionState);
  const command = useAppStore((state) => state.command);

  const runtime = useExternalStoreRuntime({
    messages,
    isRunning,
    convertMessage: (message): ThreadMessageLike => message,
    onNew: async (message: AppendMessage) => {
      if (connectionState !== "connected") throw new Error("Connect to a Pi instance before sending.");
      const text = message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n").trim();
      if (!text) return;
      await command({ type: isRunning ? "steer" : "prompt", message: text });
    },
    onCancel: async () => { await command({ type: "abort" }); },
  });

  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}
