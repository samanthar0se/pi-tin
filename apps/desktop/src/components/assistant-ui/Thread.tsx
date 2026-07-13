import { useState } from "react";
import {
  ActionBarPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAssistantState,
} from "@assistant-ui/react";
import { ArrowDown, ArrowUp, Check, Copy, Square } from "lucide-react";
import { MarkdownText } from "./MarkdownText";
import { ToolCard } from "./ToolCard";
import { useAppStore } from "../../remote/store";

export function Thread() {
  return <ThreadPrimitive.Root className="thread-root">
    <ThreadPrimitive.Viewport className="thread-viewport">
      <div className="thread-column">
        <ThreadPrimitive.Empty><Welcome /></ThreadPrimitive.Empty>
        <ThreadPrimitive.Messages components={{ Message: ThreadMessage }} />
        <ThreadPrimitive.ViewportFooter className="composer-footer">
          <ThreadPrimitive.ScrollToBottom asChild>
            <button className="scroll-bottom" title="Scroll to bottom"><ArrowDown size={16} /></button>
          </ThreadPrimitive.ScrollToBottom>
          <Composer />
        </ThreadPrimitive.ViewportFooter>
      </div>
    </ThreadPrimitive.Viewport>
  </ThreadPrimitive.Root>;
}

function Welcome() {
  const state = useAppStore((s) => s.connectionState);
  return <div className="welcome"><div className="pi-mark">π</div><h2>{state === "connected" ? "What should Pi work on?" : "Connect to a Pi instance"}</h2><p>Your remote session remains authoritative. Messages and tool activity are mirrored here.</p></div>;
}

function ThreadMessage() {
  const role = useAssistantState((s) => s.message.role);
  return role === "user" ? <UserMessage /> : <AssistantMessage />;
}

function UserMessage() {
  return <MessagePrimitive.Root className="message user-message">
    <div className="user-bubble"><MessagePrimitive.Parts /></div>
  </MessagePrimitive.Root>;
}

function Reasoning({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return <details className="reasoning" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>Thinking <span>{open ? "hide" : "show"}</span></summary><div>{text}</div>
  </details>;
}

function AssistantMessage() {
  return <MessagePrimitive.Root className="message assistant-message">
    <div className="assistant-content">
      <MessagePrimitive.Parts components={{ Text: MarkdownText, Reasoning, tools: { Fallback: ToolCard } }} />
      <RunningDot />
    </div>
    <ActionBarPrimitive.Root hideWhenRunning autohide="not-last" className="message-actions">
      <ActionBarPrimitive.Copy asChild><button title="Copy response"><CopyIcon /></button></ActionBarPrimitive.Copy>
    </ActionBarPrimitive.Root>
  </MessagePrimitive.Root>;
}

function CopyIcon() {
  const copied = useAssistantState((s) => s.message.isCopied);
  return copied ? <Check size={15} /> : <Copy size={15} />;
}

function RunningDot() {
  const running = useAssistantState((s) => s.message.status?.type === "running" && s.message.parts.length === 0);
  return running ? <div className="thinking-dot"><i /><i /><i /></div> : null;
}

function Composer() {
  const connected = useAppStore((s) => s.connectionState === "connected");
  const running = useAssistantState((s) => s.thread.isRunning);
  const command = useAppStore((s) => s.command);
  const [guidance, setGuidance] = useState("");
  const [delivery, setDelivery] = useState<"steer" | "follow_up">("steer");
  if (running) {
    const sendGuidance = () => {
      const message = guidance.trim();
      if (!message) return;
      setGuidance("");
      void command({ type: delivery, message });
    };
    return <div className="composer active-composer">
      <textarea value={guidance} onChange={(e) => setGuidance(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); sendGuidance(); } }} rows={1} placeholder={delivery === "steer" ? "Send guidance during this turn…" : "Queue a follow-up turn…"} />
      <div className="composer-row"><select value={delivery} onChange={(e) => setDelivery(e.target.value as typeof delivery)}><option value="steer">Steer now</option><option value="follow_up">Follow up</option></select><div>
        <ComposerPrimitive.Cancel asChild><button className="stop-button" title="Stop"><Square size={13} fill="currentColor" /></button></ComposerPrimitive.Cancel>
        <button className="send-button" disabled={!connected || !guidance.trim()} onClick={sendGuidance} title="Send guidance"><ArrowUp size={17} /></button>
      </div></div>
    </div>;
  }
  return <ComposerPrimitive.Root className="composer">
    <ComposerPrimitive.Input disabled={!connected} autoFocus rows={1} placeholder={connected ? "Ask Pi to make a change…" : "Select a connected instance"} />
    <div className="composer-row"><span>Enter to send · Shift+Enter for newline</span><div>
      <ComposerPrimitive.Send asChild><button className="send-button" disabled={!connected} title="Send"><ArrowUp size={17} /></button></ComposerPrimitive.Send>
    </div></div>
  </ComposerPrimitive.Root>;
}
