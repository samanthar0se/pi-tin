import { useEffect, useState } from "react";
import { Archive, Code2, FilePlus2, Moon, Settings, Sun, Unplug, X, Zap } from "lucide-react";
import { Toaster, toast } from "sonner";
import { ExtensionUiDialog } from "./components/ExtensionUiDialog";
import { HostSettingsDialog } from "./components/HostSettingsDialog";
import { NewSessionDialog } from "./components/NewSessionDialog";
import { Thread } from "./components/assistant-ui/Thread";
import { ReviewPanel } from "./components/review/ReviewPanel";
import { PiRuntimeProvider } from "./runtime/PiRuntimeProvider";
import { useAppStore } from "./remote/store";

function sessionLabel(name: string | null, cwd: string): string {
  if (name) return name;
  return cwd.split(/[\\/]/).filter(Boolean).at(-1) || cwd || "Pi session";
}

export default function App() {
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

  useEffect(() => { void hydrate().then(() => { if (!useAppStore.getState().profile) setSettingsOpen(true); }); }, [hydrate]);
  useEffect(() => { document.documentElement.classList.toggle("dark", dark); }, [dark]);
  useEffect(() => { if (error) toast.error(error); }, [error]);

  const run = (label: string, promise: Promise<unknown>) => toast.promise(promise, { loading: label, success: `${label} requested`, error: (caught) => caught.message });
  const connected = state === "connected";
  const hasActiveSession = Boolean(activeSessionId);
  const sessionReady = connected && hasActiveSession && rpcStatus === "ready";
  const hasGlobalReview = sessions.some((item) => Boolean(item.activeReviewId));
  const close = async (sessionId: string, label: string) => {
    if (!window.confirm(`Close ${label}? Its saved Pi transcript will remain on the host.`)) return;
    try { await closeSession(sessionId); }
    catch (caught) { toast.error(caught instanceof Error ? caught.message : "Could not close the Pi session."); }
  };

  return <div className="app-shell">
    <main>
      <header className="topbar">
        <div className="product-mark"><span>π</span><strong>Pi <em>Tin</em></strong></div>
        <div className="session-heading"><strong>{session.sessionName || (hasActiveSession ? "Remote Pi session" : "No open session")}</strong><span title={session.cwd || undefined}>{session.cwd || (profile ? "Open a Pi session to begin" : "Configure the connection in Settings")}</span></div>
        <div className="top-actions">
          <div className={`connection-pill ${state}`} title={detail}><i />{state}</div>
          <button disabled={!connected || sessions.length >= maxSessions} onClick={() => setNewSessionOpen(true)}><FilePlus2 size={15} /> New</button>
          <button disabled={!sessionReady || hasGlobalReview} className={session.planPhase !== "idle" ? "active-control" : ""} onClick={() => run("Plan mode", command({ type: "set_plan_mode", mode: session.planPhase === "idle" ? "enter" : "exit" }))}><Zap size={15} /> Plan</button>
          <button disabled={!sessionReady || hasGlobalReview} onClick={() => run("Code review", command({ type: "start_code_review" }))}><Code2 size={15} /> Review</button>
          <button className="icon-button" disabled={!sessionReady || session.isRunning} onClick={() => run("Compact", command({ type: "compact" }))} title="Compact context"><Archive size={16} /></button>
          <button className="icon-button" onClick={() => setSettingsOpen(true)} title="Connection settings"><Settings size={16} /></button>
          <button className="icon-button" onClick={() => setDark((value) => !value)} title="Toggle theme">{dark ? <Sun size={16} /> : <Moon size={16} />}</button>
        </div>
      </header>
      {state !== "connected" && <div className="offline-banner"><Unplug size={15} />{state === "connecting" ? "Connecting to Pi…" : profile ? "Pi is offline. Messages and controls are disabled until the connection returns." : "Open Settings to configure your Pi host."}</div>}
      {connected && sessions.length > 0 && <nav className="session-tabs" aria-label="Open Pi sessions">
        {sessions.map((item) => {
          const label = sessionLabel(item.sessionName, item.cwd);
          const closable = !item.isRunning && !item.activeReviewId;
          return <div key={item.sessionId} className={`session-tab ${activeSessionId === item.sessionId ? "active" : ""}`} title={item.cwd}>
            <button className="session-tab-select" onClick={() => setActiveSession(item.sessionId)}><i className={item.isRunning ? "running" : item.rpcStatus} /><span>{label}</span>{item.activeReviewId && <b />}</button>
            <button className="session-tab-close" disabled={!closable} onClick={() => void close(item.sessionId, label)} title={closable ? "Close session" : "Stop Pi and finish its review before closing"}><X size={13} /></button>
          </div>;
        })}
        {sessions.length < maxSessions && <button className="session-tab-add" onClick={() => setNewSessionOpen(true)} title="Open another working directory">+</button>}
      </nav>}
      {review && <nav className="view-tabs"><button className={!review.visible ? "active" : ""} onClick={() => showReview(false)}>Chat</button><button className={review.visible ? "active" : ""} onClick={() => showReview(true)}><span className="review-pulse" />Review</button></nav>}
      <section className="workspace">
        {!hasActiveSession
          ? <div className="no-session"><span>π</span><strong>No open Pi sessions</strong><p>Open a working directory on the remote host to start one.</p><button disabled={!connected} onClick={() => setNewSessionOpen(true)}><FilePlus2 size={15} /> New session</button></div>
          : review?.visible ? <ReviewPanel /> : <PiRuntimeProvider><Thread /></PiRuntimeProvider>}
      </section>
    </main>
    {extensionUiRequest && <ExtensionUiDialog request={extensionUiRequest} />}
    {newSessionOpen && <NewSessionDialog onClose={() => setNewSessionOpen(false)} />}
    {settingsOpen && <HostSettingsDialog onClose={() => setSettingsOpen(false)} />}
    <Toaster richColors position="bottom-right" theme={dark ? "dark" : "light"} />
  </div>;
}
