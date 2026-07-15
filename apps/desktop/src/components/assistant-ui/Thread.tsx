import { useEffect, useRef, useState, type ClipboardEvent as ReactClipboardEvent } from "react";
import {
  ActionBarPrimitive,
  AttachmentPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAssistantApi,
  useAssistantState,
  type ImageMessagePartProps,
} from "@assistant-ui/react";
import { ArrowDown, ArrowUp, Brain, Check, ChevronDown, Copy, Paperclip, Sparkles, Square, X } from "lucide-react";
import type { ImageInput, SlashCommand } from "@pi-tin/protocol";
import { toast } from "sonner";
import { MarkdownText } from "./MarkdownText";
import { ToolCard } from "./ToolCard";
import { createTurnRenderModel, formatWorkedDuration, type WorkItem, type WorkStatus } from "./turn-model";
import { useAppStore } from "../../remote/store";
import { clientSlashCommands, type ClientSlashCommand } from "../../runtime/client-slash-commands";

export function Thread({ fixtureConnected = false }: { fixtureConnected?: boolean }) {
  return <ThreadPrimitive.Root className="thread-root">
    <ThreadPrimitive.Viewport className="thread-viewport">
      <div className="thread-content">
        <ThreadPrimitive.Empty><Welcome fixtureConnected={fixtureConnected} /></ThreadPrimitive.Empty>
        <ThreadPrimitive.Messages components={{ Message: ThreadMessage }} />
      </div>
      <ThreadPrimitive.ViewportFooter className="composer-footer">
        <div className="composer-column">
          <ThreadPrimitive.ScrollToBottom asChild>
            <button className="scroll-bottom" title="Scroll to bottom"><ArrowDown size={16} /></button>
          </ThreadPrimitive.ScrollToBottom>
          <Composer fixtureConnected={fixtureConnected} />
        </div>
      </ThreadPrimitive.ViewportFooter>
    </ThreadPrimitive.Viewport>
  </ThreadPrimitive.Root>;
}

function Welcome({ fixtureConnected }: { fixtureConnected: boolean }) {
  const state = useAppStore((s) => s.connectionState);
  return <div className="welcome"><div className="pi-mark">π</div><h2>{fixtureConnected || state === "connected" ? "What should Pi work on?" : "Connect to a Pi instance"}</h2></div>;
}

function ThreadMessage() {
  const role = useAssistantState((s) => s.message.role);
  return role === "user" ? <UserMessage /> : <AssistantMessage />;
}

function UserMessage() {
  return <MessagePrimitive.Root className="message user-message">
    <div className="user-message-stack">
      <div className="user-bubble"><MessagePrimitive.Parts components={{ Image: MessageImage }} /></div>
      <div className="user-message-meta">
        <ActionBarPrimitive.Root className="user-actions"><ActionBarPrimitive.Copy asChild><button title="Copy prompt"><CopyIcon /></button></ActionBarPrimitive.Copy></ActionBarPrimitive.Root>
        <MessageMeta />
      </div>
    </div>
  </MessagePrimitive.Root>;
}

function MessageImage({ image, filename }: ImageMessagePartProps) {
  return <img className="message-image" src={image} alt={filename || "Shared image"} />;
}

function ComposerImageAttachment() {
  const file = useAssistantState((state) => state.attachment.file);
  const name = useAssistantState((state) => state.attachment.name);
  const [preview, setPreview] = useState("");
  useEffect(() => {
    if (!file) return setPreview("");
    const reader = new FileReader();
    reader.onload = () => setPreview(String(reader.result || ""));
    reader.readAsDataURL(file);
    return () => reader.abort();
  }, [file]);
  return <AttachmentPrimitive.Root className="composer-image" title={name}>
    {preview && <img src={preview} alt={name} />}
    <AttachmentPrimitive.Remove asChild><button type="button" title={`Remove ${name}`}><X size={13} /></button></AttachmentPrimitive.Remove>
  </AttachmentPrimitive.Root>;
}

function ComposerImages() {
  const count = useAssistantState((state) => state.composer.attachments.length);
  return count > 0 ? <div className="composer-images"><ComposerPrimitive.Attachments components={{ Image: ComposerImageAttachment }} /></div> : null;
}

type PastedImage = ImageInput & { id: string; name: string; preview: string };
const supportedImageTypes = new Set<ImageInput["mimeType"]>(["image/png", "image/jpeg", "image/gif", "image/webp"]);

function readPastedImage(file: File): Promise<PastedImage> {
  return new Promise((resolve, reject) => {
    if (!supportedImageTypes.has(file.type as ImageInput["mimeType"])) {
      reject(new Error("Paste a PNG, JPEG, GIF, or WebP image."));
      return;
    }
    if (file.size > 3_538_944) {
      reject(new Error("Images must be smaller than 3.4 MB."));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name || "the pasted image"}.`));
    reader.onload = () => {
      const preview = String(reader.result || "");
      const data = preview.slice(preview.indexOf(",") + 1);
      resolve({ type: "image", data, mimeType: file.type as ImageInput["mimeType"], id: crypto.randomUUID(), name: file.name || "Pasted image", preview });
    };
    reader.readAsDataURL(file);
  });
}

function GuidanceImages({ images, onRemove }: { images: PastedImage[]; onRemove: (id: string) => void }) {
  if (images.length === 0) return null;
  return <div className="composer-images">{images.map((image) => <div className="composer-image" key={image.id} title={image.name}>
    <img src={image.preview} alt={image.name} />
    <button type="button" title={`Remove ${image.name}`} onClick={() => onRemove(image.id)}><X size={13} /></button>
  </div>)}</div>;
}

function Reasoning({ text }: { text: string }) {
  return text ? <div className="reasoning-text">{text}</div> : null;
}

const turnPartComponents = { Text: MarkdownText, Reasoning, Image: MessageImage, tools: { Fallback: ToolCard } };

function WorkItemView({ item }: { item: WorkItem }) {
  if (item.kind === "activity") {
    return <MessagePrimitive.PartByIndex index={item.partIndex} components={turnPartComponents} />;
  }
  return <div className={`work-item ${item.kind}`}>
    <MessagePrimitive.PartByIndex index={item.partIndex} components={turnPartComponents} />
    {item.pending && <div className="pending-work"><span className="cadenced-shimmer">Thinking</span></div>}
  </div>;
}

function useWorkDuration(status: WorkStatus, startedAtMs?: number, completedAtMs?: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (status !== "running") return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [status]);
  if (typeof startedAtMs !== "number") return "0s";
  return formatWorkedDuration(Math.max(0, (status === "running" ? now : completedAtMs ?? now) - startedAtMs));
}

function TurnWorkDisclosure({ work }: { work: NonNullable<ReturnType<typeof createTurnRenderModel>["work"]> }) {
  const running = work.status === "running";
  const previousStatus = useRef(work.status);
  const [open, setOpen] = useState(running || work.status === "error");
  const duration = useWorkDuration(work.status, work.startedAtMs, work.completedAtMs);
  useEffect(() => {
    if (work.status === "running") setOpen(true);
    else if (previousStatus.current === "running") setOpen(false);
    previousStatus.current = work.status;
  }, [work.status]);
  const label = running ? `Working for ${duration}` : work.status === "cancelled" ? `Stopped after ${duration}` : `Worked for ${duration}`;
  return <section className={`turn-work ${work.status}`}>
    <button type="button" className="work-disclosure-trigger" disabled={running} aria-expanded={running ? true : open} onClick={() => setOpen((value) => !value)}>
      <span>{label}</span>{!running && <ChevronDown className={open ? "rotate" : ""} size={14} />}
    </button>
    <div className="work-divider" />
    {open && <div className="work-transcript">
      {work.items.length > 0 ? work.items.map((item) => <WorkItemView key={item.id} item={item} />) : <div className="pending-work"><span className="cadenced-shimmer">Thinking</span></div>}
    </div>}
  </section>;
}

function MessageMeta({ className = "" }: { className?: string }) {
  const createdAt = useAssistantState((state) => state.message.createdAt);
  if (!(createdAt instanceof Date) || !Number.isFinite(createdAt.getTime())) return null;
  const label = createdAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return <time className={`message-time ${className}`} dateTime={createdAt.toISOString()}>{label}</time>;
}

function AssistantMessage() {
  const parts = useAssistantState((state) => state.message.parts);
  const status = useAssistantState((state) => state.message.status as { type?: string; reason?: string } | undefined);
  const timing = useAssistantState((state) => state.message.metadata.custom as { startedAtMs?: number; completedAtMs?: number });
  const model = createTurnRenderModel(parts, { messageStatus: status, startedAtMs: timing?.startedAtMs, completedAtMs: timing?.completedAtMs });
  return <MessagePrimitive.Root className="message assistant-message">
    <div className="assistant-content">
      {model.work && <TurnWorkDisclosure work={model.work} />}
      {model.answerParts.length > 0 && <div className="final-answer">{model.answerParts.map((index) => <MessagePrimitive.PartByIndex key={index} index={index} components={turnPartComponents} />)}</div>}
    </div>
    <div className="assistant-meta">
      <ActionBarPrimitive.Root hideWhenRunning autohide="not-last" className="message-actions">
        <ActionBarPrimitive.Copy asChild><button title="Copy response"><CopyIcon /></button></ActionBarPrimitive.Copy>
      </ActionBarPrimitive.Root>
      <MessageMeta />
    </div>
  </MessagePrimitive.Root>;
}

function CopyIcon() {
  const copied = useAssistantState((s) => s.message.isCopied);
  return copied ? <Check size={15} /> : <Copy size={15} />;
}

type DisplayCommand = SlashCommand | ClientSlashCommand;

function CommandCompletion({ text, connected, allowSessionCommands, onComplete }: { text: string; connected: boolean; allowSessionCommands: boolean; onComplete: (value: string) => void }) {
  const remoteCommands = useAppStore((state) => state.session.commands);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const trimmed = text.trimStart();
  const query = trimmed.slice(1).toLowerCase();
  const localCommands: DisplayCommand[] = allowSessionCommands ? clientSlashCommands : [];
  const localNames = new Set<string>(localCommands.map((command) => command.name));
  const commands: DisplayCommand[] = [...localCommands, ...remoteCommands.filter((command) => !localNames.has(command.name))];
  const matches = connected && trimmed.startsWith("/") && !trimmed.slice(1).includes(" ")
    ? commands.filter((command) => command.name.toLowerCase().includes(query) || command.description?.toLowerCase().includes(query))
    : [];

  useEffect(() => { setSelectedIndex(0); }, [query, allowSessionCommands]);
  useEffect(() => { listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" }); }, [selectedIndex]);
  useEffect(() => {
    if (matches.length === 0) return;
    const navigate = (event: KeyboardEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLTextAreaElement) || !target.closest(".composer")) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        setSelectedIndex((index) => event.key === "ArrowDown" ? (index + 1) % matches.length : (index - 1 + matches.length) % matches.length);
      } else if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        event.stopPropagation();
        const selected = matches[selectedIndex] ?? matches[0];
        if (selected) onComplete(`/${selected.name} `);
      }
    };
    window.addEventListener("keydown", navigate, true);
    return () => window.removeEventListener("keydown", navigate, true);
  }, [matches, onComplete, selectedIndex]);

  if (matches.length === 0) return null;
  return <div ref={listRef} className="command-completion" role="listbox" aria-label="Pi slash commands">
    {matches.map((command, index) => <button key={`${command.source}:${command.name}`} type="button" role="option" aria-selected={index === selectedIndex} onMouseEnter={() => setSelectedIndex(index)} onMouseDown={(event) => {
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
  return <CommandCompletion text={text} connected={connected} allowSessionCommands onComplete={(value) => api.composer().setText(value)} />;
}

function ComposerControls({ connected }: { connected: boolean }) {
  const session = useAppStore((state) => state.session);
  const command = useAppStore((state) => state.command);
  const run = (label: string, promise: Promise<unknown>) => toast.promise(promise, { loading: label, success: `${label} requested`, error: (caught) => caught.message });
  return <div className="composer-controls" title="Model and thinking level">
    <label className="model-select"><Sparkles size={14} /><select aria-label="Model" disabled={!connected} value={session.model ? `${session.model.provider}/${session.model.id}` : ""} onChange={(event) => { const [provider, ...rest] = event.target.value.split("/"); run("Switch model", command({ type: "set_model", provider, modelId: rest.join("/") })); }}><option value="">Choose model</option>{session.availableModels.map((model) => <option key={`${model.provider}/${model.id}`} value={`${model.provider}/${model.id}`}>{model.name || model.id}</option>)}</select></label>
    <i />
    <label className="thinking-select"><Brain size={14} /><select aria-label="Thinking level" disabled={!connected} value={session.thinkingLevel} onChange={(event) => run("Thinking level", command({ type: "set_thinking", level: event.target.value as any }))}>{["off", "minimal", "low", "medium", "high", "xhigh"].map((value) => <option key={value}>{value}</option>)}</select><ChevronDown size={12} /></label>
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

function Composer({ fixtureConnected }: { fixtureConnected: boolean }) {
  const storeConnected = useAppStore((s) => s.connectionState === "connected");
  const connected = fixtureConnected || storeConnected;
  const running = useAssistantState((s) => s.thread.isRunning);
  const command = useAppStore((s) => s.command);
  const slashCommands = useAppStore((s) => s.session.commands);
  const [guidance, setGuidance] = useState("");
  const [guidanceImages, setGuidanceImages] = useState<PastedImage[]>([]);
  const [delivery, setDelivery] = useState<"steer" | "follow_up">("steer");
  const [stopping, setStopping] = useState(false);
  const guidanceFileInput = useRef<HTMLInputElement>(null);
  if (running) {
    const sendGuidance = () => {
      const message = guidance.trim();
      if (!message && guidanceImages.length === 0) return;
      setGuidance("");
      setGuidanceImages([]);
      const commandName = message.startsWith("/") ? message.slice(1).split(/\s/, 1)[0] : undefined;
      const slashCommand = slashCommands.find((candidate) => candidate.name === commandName);
      const images = guidanceImages.map(({ type, data, mimeType }) => ({ type, data, mimeType }));
      void command(slashCommand?.source === "extension"
        ? { type: "prompt", message, images: images.length ? images : undefined }
        : { type: delivery, message, images: images.length ? images : undefined });
    };
    const addImages = (files: File[]) => {
      if (files.length === 0) return;
      const available = Math.max(0, 10 - guidanceImages.length);
      if (files.length > available) toast.error("You can send up to 10 images at once.");
      void Promise.all(files.slice(0, available).map(readPastedImage))
        .then((images) => setGuidanceImages((current) => [...current, ...images]))
        .catch((error) => toast.error(error instanceof Error ? error.message : "Could not add image"));
    };
    const pasteImages = (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
      const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
      if (files.length === 0) return;
      event.preventDefault();
      addImages(files);
    };
    const stop = async () => {
      setStopping(true);
      try { await command({ type: "abort" }); }
      catch (error) { toast.error(error instanceof Error ? error.message : "Could not stop Pi"); }
      finally { setStopping(false); }
    };
    const hasGuidance = Boolean(guidance.trim() || guidanceImages.length > 0);
    return <div className="composer active-composer">
      <CommandCompletion text={guidance} connected={connected} allowSessionCommands={false} onComplete={setGuidance} />
      <GuidanceImages images={guidanceImages} onRemove={(id) => setGuidanceImages((images) => images.filter((image) => image.id !== id))} />
      <textarea value={guidance} onChange={(e) => setGuidance(e.target.value)} onPaste={pasteImages} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); sendGuidance(); } }} rows={1} placeholder={delivery === "steer" ? "Send guidance or paste an image…" : "Queue a follow-up or paste an image…"} />
      <input ref={guidanceFileInput} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple onChange={(event) => { addImages(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
      <div className="composer-row"><div className="composer-left"><button type="button" className="composer-icon" disabled={!connected} onClick={() => guidanceFileInput.current?.click()} title="Attach images"><Paperclip size={15} /></button><label className="delivery-control"><select aria-label="Guidance delivery" value={delivery} onChange={(e) => setDelivery(e.target.value as typeof delivery)}><option value="steer">Steer now</option><option value="follow_up">Follow up</option></select><ChevronDown size={12} /></label></div><div>
        <ContextWindowIndicator />
        {hasGuidance && <button className="composer-icon secondary-stop" disabled={!connected || stopping} onClick={() => void stop()} title={stopping ? "Stopping Pi" : "Stop Pi"}><Square size={10} fill="currentColor" /></button>}
        {hasGuidance
          ? <button className="send-button" disabled={!connected} onClick={sendGuidance} title="Send guidance"><ArrowUp size={17} /></button>
          : <button className="send-button stop-control" disabled={!connected || stopping} onClick={() => void stop()} title={stopping ? "Stopping Pi" : "Stop Pi"}><Square size={11} fill="currentColor" /></button>}
      </div></div>
    </div>;
  }
  return <ComposerPrimitive.Root className="composer">
    <IdleCommandCompletion connected={connected} />
    <ComposerImages />
    <ComposerPrimitive.Input disabled={!connected} autoFocus rows={1} placeholder={connected ? "Ask Pi to make a change, paste an image, or type /…" : "Select a connected instance"} />
    <div className="composer-row"><div className="composer-left"><ComposerPrimitive.AddAttachment asChild><button type="button" className="composer-icon" disabled={!connected} title="Attach images"><Paperclip size={15} /></button></ComposerPrimitive.AddAttachment></div><div>
      <ComposerControls connected={connected} /><ContextWindowIndicator />
      <ComposerPrimitive.Send asChild><button className="send-button" disabled={!connected} title="Send"><ArrowUp size={17} /></button></ComposerPrimitive.Send>
    </div></div>
  </ComposerPrimitive.Root>;
}
