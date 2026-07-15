import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { SessionDescriptor } from "@pi-tin/protocol";
import { Archive, CheckCircle2, CircleAlert, Code2, FilePlus2, LoaderCircle, MessageCircleQuestion, Moon, RotateCcw, Settings, Sun, Unplug, X, Zap } from "lucide-react";
import { Toaster, toast } from "sonner";
import { ExtensionUiDialog } from "./components/ExtensionUiDialog";
import { HostSettingsDialog } from "./components/HostSettingsDialog";
import { NewSessionDialog } from "./components/NewSessionDialog";
import { ChatFixture } from "./components/assistant-ui/ChatFixture";
import { Thread } from "./components/assistant-ui/Thread";
import { ReviewPanel } from "./components/review/ReviewPanel";
import { PiRuntimeProvider } from "./runtime/PiRuntimeProvider";
import { useAppStore, type SessionAttention } from "./remote/store";
import { visibleSessionAttention } from "./remote/attention";

function sessionLabel(name: string | null, cwd: string): string {
  if (name) return name;
  return cwd.split(/[\\/]/).filter(Boolean).at(-1) || cwd || "Pi session";
}

function attentionLabel(attention: SessionAttention): string | null {
  if (attention === "completed") return "Completed while you were away";
  if (attention === "needs-input") return "Needs your input";
  if (attention === "review") return "Review ready";
  if (attention === "failed") return "Needs attention";
  return null;
}

function AttentionIcon({ attention }: { attention: Exclude<SessionAttention, null> }) {
  if (attention === "completed") return <CheckCircle2 />;
  if (attention === "needs-input") return <MessageCircleQuestion />;
  if (attention === "review") return <Code2 />;
  return <CircleAlert />;
}

function sessionTabId(sessionId: string): string {
  return `session-tab-${encodeURIComponent(sessionId)}`;
}

function SessionTab({
  item,
  selected,
  onSelect,
  onClose,
  onNavigate,
}: {
  item: SessionDescriptor;
  selected: boolean;
  onSelect: (sessionId: string) => void;
  onClose: (sessionId: string, label: string) => void;
  onNavigate: (event: ReactKeyboardEvent<HTMLButtonElement>, sessionId: string) => void;
}) {
  const attention = useAppStore((state) => {
    const view = state.sessionViews[item.sessionId];
    return visibleSessionAttention({
      stored: view?.attention ?? null,
      hasPendingInput: Boolean(view?.extensionUiRequest),
      hasReview: Boolean(item.activeReviewId),
    });
  });
  const label = sessionLabel(item.sessionName, item.cwd);
  const closable = !item.isRunning && item.rpcStatus !== "starting" && !item.activeReviewId;
  const attentionText = attentionLabel(attention);
  const runtimeText = item.isRunning ? "Working" : item.rpcStatus === "ready" ? "Ready" : item.rpcStatus === "starting" ? "Starting" : item.rpcStatus === "error" ? "Runtime failed" : "Stopped";

  return <div className={`session-tab ${selected ? "active" : ""} ${attention ? `attention-${attention}` : ""}`} title={item.cwd} role="presentation">
    <button
      id={sessionTabId(item.sessionId)}
      className="session-tab-select"
      role="tab"
      aria-controls="session-workspace"
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      aria-label={`${label}, ${attentionText || runtimeText}`}
      onClick={() => onSelect(item.sessionId)}
      onKeyDown={(event) => onNavigate(event, item.sessionId)}
    >
      <i aria-hidden="true" className={item.isRunning ? "running" : item.rpcStatus} />
      <span>{label}</span>
      {attention && <span className={`session-attention ${attention}`} title={attentionText || undefined}><AttentionIcon attention={attention} /><span className="visually-hidden">{attentionText}</span></span>}
    </button>
    <button className="session-tab-close" tabIndex={selected ? 0 : -1} aria-label={`Close ${label}`} disabled={!closable} onClick={() => onClose(item.sessionId, label)} title={closable ? "Close session" : item.rpcStatus === "starting" ? "Wait for Pi to finish starting before closing" : "Stop Pi and finish its review before closing"}><X size={13} /></button>
  </div>;
}

export default function App() {
  const fixtureName = import.meta.env.DEV ? new URLSearchParams(window.location.search).get("chatFixture") : null;
  const hydrate = useAppStore((state) => state.hydrateProfile);
  const profile = useAppStore((state) => state.profile);
  const sessions = useAppStore((state) => state.sessions);
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const maxSessions = useAppStore((state) => state.maxSessions);
  const setActiveSession = useAppStore((state) => state.setActiveSession);
  const closeSession = useAppStore((state) => state.closeSession);
  const session = useAppStore((state) => state.session);
  const rpcStatus = useAppStore((state) => state.rpcStatus);
  const state = useAppStore((store) => store.connectionState);
  const detail = useAppStore((store) => store.connectionDetail);
  const command = useAppStore((store) => store.command);
  const review = useAppStore((store) => store.review);
  const extensionUiRequest = useAppStore((store) => store.extensionUiRequest);
  const showReview = useAppStore((store) => store.showReview);
  const error = useAppStore((store) => store.lastError);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  const [dark, setDark] = useState(() => matchMedia("(prefers-color-scheme: dark)").matches);

  useEffect(() => { if (!fixtureName) void hydrate().then(() => { if (!useAppStore.getState().profile) setSettingsOpen(true); }); }, [fixtureName, hydrate]);
  useEffect(() => { document.documentElement.classList.toggle("dark", dark); }, [dark]);
  useEffect(() => { if (error) toast.error(error); }, [error]);

  if (fixtureName) return <ChatFixture name={fixtureName} />;

  const run = (label: string, promise: Promise<unknown>) => toast.promise(promise, { loading: label, success: `${label} requested`, error: (caught) => caught.message });
  const connected = state === "connected";
  const hasActiveSession = Boolean(activeSessionId);
  const sessionReady = connected && hasActiveSession && rpcStatus === "ready";
  const sessionFailed = connected && hasActiveSession && rpcStatus === "error";
  const compacting = session.operation === "compacting";
  const hasGlobalReview = sessions.some((item) => Boolean(item.activeReviewId));
  const newSessionTitle = !connected
    ? "Connect to the Pi host before opening a workspace"
    : sessions.length >= maxSessions ? `${maxSessions}-workspace limit reached` : "Open workspace";
  const connectionMessage = state === "connecting" ? "Connecting to Pi…"
    : state === "error" ? detail || "Pi could not connect. Check the host, token, and protocol version."
    : profile ? "Pi is offline. Your transcripts are safe; sending will return when the connection recovers."
    : "Open Connection settings to configure your Pi host.";
  const close = async (sessionId: string, label: string) => {
    if (!window.confirm(`Close ${label}? Its saved Pi transcript will remain on the host.`)) return;
    try {
      await closeSession(sessionId);
      requestAnimationFrame(() => {
        const nextId = useAppStore.getState().activeSessionId;
        (nextId ? document.getElementById(sessionTabId(nextId)) : document.getElementById("open-workspace-button"))?.focus();
      });
    }
    catch (caught) { toast.error(caught instanceof Error ? caught.message : "Could not close the Pi session."); }
  };
  const navigateSessionTabs = (event: ReactKeyboardEvent<HTMLButtonElement>, sessionId: string) => {
    const currentIndex = sessions.findIndex((item) => item.sessionId === sessionId);
    if (currentIndex < 0) return;
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % sessions.length;
    if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + sessions.length) % sessions.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = sessions.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextId = sessions[nextIndex].sessionId;
    setActiveSession(nextId);
    requestAnimationFrame(() => document.getElementById(sessionTabId(nextId))?.focus());
  };

  return <div className="app-shell">
    <main>
      <header className="topbar">
        <div className="product-mark"><span>π</span><strong>Pi <em>Tin</em></strong></div>
        <div className="session-heading"><strong>{session.sessionName || (hasActiveSession ? "Remote Pi session" : "No open session")}</strong><span title={session.cwd || undefined}>{session.cwd || (profile ? "Open a Pi session to begin" : "Configure the connection in Settings")}</span></div>
        <div className="top-actions">
          <div className={`connection-pill ${state}`} title={detail}><i />{state}</div>
          <button id="open-workspace-button" className="new-action" title={newSessionTitle} disabled={!connected || sessions.length >= maxSessions} onClick={() => setNewSessionOpen(true)}><FilePlus2 size={15} /><span>Open</span></button>
          {sessionFailed && <button className="restart-action" title="Retry the selected Pi runtime" onClick={() => run("Restart Pi", command({ type: "restart_pi" }, 120_000))}><RotateCcw size={15} /><span>Retry Pi</span></button>}
          <button disabled={!sessionReady || hasGlobalReview} title="Toggle plan mode" className={`plan-action ${session.planPhase !== "idle" ? "active-control" : ""}`} onClick={() => run("Plan mode", command({ type: "set_plan_mode", mode: session.planPhase === "idle" ? "enter" : "exit" }))}><Zap size={15} /><span>Plan</span></button>
          <button className="review-action" title="Review changes" disabled={!sessionReady || hasGlobalReview} onClick={() => run("Code review", command({ type: "start_code_review" }))}><Code2 size={15} /><span>Review</span></button>
          <button className="icon-button" disabled={!sessionReady || session.isRunning} onClick={() => run("Compact", command({ type: "compact" }))} title={compacting ? "Compacting context…" : "Compact context"}>{compacting ? <LoaderCircle className="spin" size={16} /> : <Archive size={16} />}</button>
          <button className="icon-button" onClick={() => setSettingsOpen(true)} title="Connection settings"><Settings size={16} /></button>
          <button className="icon-button" onClick={() => setDark((value) => !value)} title="Toggle theme">{dark ? <Sun size={16} /> : <Moon size={16} />}</button>
        </div>
      </header>
      {state !== "connected" && <div className={`offline-banner ${state}`} role="status"><Unplug size={15} /><span>{connectionMessage}</span>{state === "error" && <button onClick={() => setSettingsOpen(true)}>Connection settings</button>}</div>}
      {connected && sessions.length > 0 && <nav className="session-tabs" aria-label="Open Pi sessions" role="tablist">
        {sessions.map((item) => <SessionTab
          key={item.sessionId}
          item={item}
          selected={activeSessionId === item.sessionId}
          onSelect={setActiveSession}
          onClose={(sessionId, label) => void close(sessionId, label)}
          onNavigate={navigateSessionTabs}
        />)}
        {sessions.length < maxSessions && <button className="session-tab-add" onClick={() => setNewSessionOpen(true)} title="Open another working directory">+</button>}
      </nav>}
      {review && <nav className="view-tabs"><button className={!review.visible ? "active" : ""} onClick={() => showReview(false)}>Chat</button><button className={review.visible ? "active" : ""} onClick={() => showReview(true)}><span className="review-pulse" />Review</button></nav>}
      <section className="workspace" id="session-workspace" role={connected && hasActiveSession ? "tabpanel" : undefined} aria-labelledby={connected && activeSessionId ? sessionTabId(activeSessionId) : undefined}>
        {!hasActiveSession
          ? <div className="no-session"><span>π</span><strong>No open workspaces</strong><p>Open a working directory on the remote host to start one.</p><button disabled={!connected} onClick={() => setNewSessionOpen(true)}><FilePlus2 size={15} /> Open workspace</button></div>
          : review?.visible ? <ReviewPanel /> : <PiRuntimeProvider key={activeSessionId} sessionId={activeSessionId!}><Thread /></PiRuntimeProvider>}
      </section>
    </main>
    {extensionUiRequest && <ExtensionUiDialog request={extensionUiRequest} />}
    {newSessionOpen && <NewSessionDialog onClose={() => setNewSessionOpen(false)} />}
    {settingsOpen && <HostSettingsDialog onClose={() => setSettingsOpen(false)} />}
    <Toaster richColors position="bottom-right" theme={dark ? "dark" : "light"} />
  </div>;
}
