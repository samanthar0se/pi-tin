import { useState, type ReactNode } from "react";
import {
  ActionBarPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAssistantApi,
  useAssistantState,
} from "@assistant-ui/react";
import { ArrowDown, ArrowUp, Brain, Check, ChevronDown, Copy, LoaderCircle, Sparkles, Square } from "lucide-react";
import type { SlashCommand } from "@pi-remote/protocol";
import { toast } from "sonner";
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
  return text ? <div className="reasoning-text">{text}</div> : null;
}

function groupTaskParts(parts: readonly any[]) {
  let lastToolIndex = -1;
  parts.forEach((part, index) => { if (part.type === "tool-call") lastToolIndex = index; });
  const activity: number[] = [];
  const visible: { groupKey: undefined; indices: number[] }[] = [];
  parts.forEach((part, index) => {
    if (part.type === "reasoning" || part.type === "tool-call" || index < lastToolIndex) activity.push(index);
    else visible.push({ groupKey: undefined, indices: [index] });
  });
  return [...(activity.length ? [{ groupKey: "task-activity", indices: activity }] : []), ...visible];
}

function TaskActivity({ groupKey, indices, children }: { groupKey: string | undefined; indices: number[]; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const parts = useAssistantState((state) => state.message.parts);
  if (!groupKey) return <>{children}</>;
  const tools = indices.map((index) => parts[index]).filter((part) => part?.type === "tool-call");
  const running = tools.some((part) => part?.type === "tool-call" && part.result === undefined);
  const failed = tools.some((part) => part?.type === "tool-call" && part.isError);
  const detail = tools.length ? `${tools.length} action${tools.length === 1 ? "" : "s"}` : "reasoning";
  return <details className={`reasoning task-activity ${failed ? "error" : ""}`} open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>{running && <LoaderCircle className="spin" size={14} />}<span>Thinking</span><em>{running ? "Working" : detail}</em><ChevronDown className={open ? "rotate" : ""} size={14} /></summary>
    <div className="task-activity-content">{children}</div>
  </details>;
}

function AssistantMessage() {
  return <MessagePrimitive.Root className="message assistant-message">
    <div className="assistant-content">
      <MessagePrimitive.Unstable_PartsGrouped groupingFunction={groupTaskParts} components={{ Text: MarkdownText, Reasoning, Group: TaskActivity, tools: { Fallback: ToolCard } }} />
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

type DisplayCommand = SlashCommand | { name: "new"; description: string; source: "client"; scope: "temporary" };

function CommandCompletion({ text, connected, allowNew, onComplete }: { text: string; connected: boolean; allowNew: boolean; onComplete: (value: string) => void }) {
  const remoteCommands = useAppStore((state) => state.session.commands);
  const trimmed = text.trimStart();
  if (!connected || !trimmed.startsWith("/") || trimmed.slice(1).includes(" ")) return null;
  const query = trimmed.slice(1).toLowerCase();
  const localCommands: DisplayCommand[] = allowNew
    ? [{ name: "new", description: "Start a fresh persistent session", source: "client", scope: "temporary" }]
    : [];
  const commands: DisplayCommand[] = [...localCommands, ...remoteCommands.filter((command) => command.name !== "new")];
  const matches = commands.filter((command) => command.name.toLowerCase().includes(query) || command.description?.toLowerCase().includes(query));
  if (matches.length === 0) return null;
  return <div className="command-completion" role="listbox" aria-label="Pi slash commands">
    {matches.map((command) => <button key={`${command.source}:${command.name}`} type="button" role="option" onMouseDown={(event) => {
      event.preventDefault();
      onComplete(`/${command.name} `);
    }}>
      <span><strong>/{command.name}</strong>{command.description && <small>{command.description}</small>}</span>
      <em>{command.source === "client" ? "Pi" : command.source}</em>
    </button>)}
  </div>;
}

function IdleCommandCompletion({ connected }: { connected: boolean }) {
  const text = useAssistantState((state) => state.composer.text);
  const api = useAssistantApi();
  return <CommandCompletion text={text} connected={connected} allowNew onComplete={(value) => api.composer().setText(value)} />;
}

function ComposerControls({ connected }: { connected: boolean }) {
  const session = useAppStore((state) => state.session);
  const command = useAppStore((state) => state.command);
  const run = (label: string, promise: Promise<unknown>) => toast.promise(promise, { loading: label, success: `${label} requested`, error: (caught) => caught.message });
  return <div className="composer-controls">
    <label><Sparkles size={14} /><select aria-label="Model" disabled={!connected} value={session.model ? `${session.model.provider}/${session.model.id}` : ""} onChange={(event) => { const [provider, ...rest] = event.target.value.split("/"); run("Switch model", command({ type: "set_model", provider, modelId: rest.join("/") })); }}><option value="">Choose model</option>{session.availableModels.map((model) => <option key={`${model.provider}/${model.id}`} value={`${model.provider}/${model.id}`}>{model.name || model.id}</option>)}</select><ChevronDown size={12} /></label>
    <label><Brain size={14} /><select aria-label="Thinking level" disabled={!connected} value={session.thinkingLevel} onChange={(event) => run("Thinking level", command({ type: "set_thinking", level: event.target.value as any }))}>{["off", "minimal", "low", "medium", "high", "xhigh"].map((value) => <option key={value}>{value}</option>)}</select><ChevronDown size={12} /></label>
  </div>;
}

function formatTokens(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: value >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
}

function ContextWindowIndicator() {
  const contextUsage = useAppStore((state) => state.session.contextUsage);
  const model = useAppStore((state) => state.session.model);
  const messageCount = useAppStore((state) => state.session.messages.length);
  const contextWindow = contextUsage?.contextWindow ?? model?.contextWindow;
  if (typeof contextWindow !== "number" || contextWindow <= 0) return null;
  const percent = typeof contextUsage?.percent === "number" ? contextUsage.percent : messageCount === 0 ? 0 : null;
  const fill = Math.min(100, Math.max(0, percent ?? 0));
  const level = fill >= 90 ? "danger" : fill >= 70 ? "warning" : "normal";
  const label = percent === null || contextUsage?.tokens === null
    ? `Context usage unavailable · ${formatTokens(contextWindow)} token window`
    : `${Math.round(percent)}% context used · ${formatTokens(contextUsage?.tokens ?? 0)} / ${formatTokens(contextWindow)} tokens`;
  return <span className={`context-window ${level}`} role="img" aria-label={label} title={label}>
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle className="context-track" cx="10" cy="10" r="7.5" pathLength="100" />
      <circle className="context-value" cx="10" cy="10" r="7.5" pathLength="100" strokeDasharray={`${fill} 100`} />
    </svg>
  </span>;
}

function Composer() {
  const connected = useAppStore((s) => s.connectionState === "connected");
  const running = useAssistantState((s) => s.thread.isRunning);
  const command = useAppStore((s) => s.command);
  const slashCommands = useAppStore((s) => s.session.commands);
  const [guidance, setGuidance] = useState("");
  const [delivery, setDelivery] = useState<"steer" | "follow_up">("steer");
  const [stopping, setStopping] = useState(false);
  if (running) {
    const sendGuidance = () => {
      const message = guidance.trim();
      if (!message) return;
      setGuidance("");
      const commandName = message.startsWith("/") ? message.slice(1).split(/\s/, 1)[0] : undefined;
      const slashCommand = slashCommands.find((candidate) => candidate.name === commandName);
      void command(slashCommand?.source === "extension" ? { type: "prompt", message } : { type: delivery, message });
    };
    const stop = async () => {
      setStopping(true);
      try { await command({ type: "abort" }); }
      catch (error) { toast.error(error instanceof Error ? error.message : "Could not stop Pi"); }
      finally { setStopping(false); }
    };
    return <div className="composer active-composer">
      <CommandCompletion text={guidance} connected={connected} allowNew={false} onComplete={setGuidance} />
      <textarea value={guidance} onChange={(e) => setGuidance(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); sendGuidance(); } }} rows={1} placeholder={delivery === "steer" ? "Send guidance during this turn…" : "Queue a follow-up turn…"} />
      <div className="composer-row"><select value={delivery} onChange={(e) => setDelivery(e.target.value as typeof delivery)}><option value="steer">Steer now</option><option value="follow_up">Follow up</option></select><div>
        <ContextWindowIndicator />
        <button className="stop-button" disabled={!connected || stopping} onClick={() => void stop()} title="Stop Pi"><Square size={11} fill="currentColor" />{stopping ? "Stopping…" : "Stop"}</button>
        <button className="send-button" disabled={!connected || !guidance.trim()} onClick={sendGuidance} title="Send guidance"><ArrowUp size={17} /></button>
      </div></div>
    </div>;
  }
  return <ComposerPrimitive.Root className="composer">
    <IdleCommandCompletion connected={connected} />
    <ComposerPrimitive.Input disabled={!connected} autoFocus rows={1} placeholder={connected ? "Ask Pi to make a change or type / for commands…" : "Select a connected instance"} />
    <div className="composer-row"><ComposerControls connected={connected} /><div>
      <ContextWindowIndicator />
      <ComposerPrimitive.Send asChild><button className="send-button" disabled={!connected} title="Send"><ArrowUp size={17} /></button></ComposerPrimitive.Send>
    </div></div>
  </ComposerPrimitive.Root>;
}
