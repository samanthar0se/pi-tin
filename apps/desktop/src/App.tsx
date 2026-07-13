import { useEffect, useState } from "react";
import { Brain, ChevronDown, Code2, Moon, PanelLeft, Sparkles, Sun, Unplug, Zap } from "lucide-react";
import { Toaster, toast } from "sonner";
import { InstanceSidebar } from "./components/InstanceSidebar";
import { Thread } from "./components/assistant-ui/Thread";
import { ReviewPanel } from "./components/review/ReviewPanel";
import { PiRuntimeProvider } from "./runtime/PiRuntimeProvider";
import { useAppStore } from "./remote/store";

export default function App() {
  const hydrate = useAppStore((s) => s.hydrateProfiles);
  const session = useAppStore((s) => s.session);
  const state = useAppStore((s) => s.connectionState);
  const detail = useAppStore((s) => s.connectionDetail);
  const command = useAppStore((s) => s.command);
  const review = useAppStore((s) => s.review);
  const showReview = useAppStore((s) => s.showReview);
  const error = useAppStore((s) => s.lastError);
  const [dark, setDark] = useState(() => matchMedia("(prefers-color-scheme: dark)").matches);
  const [sidebar, setSidebar] = useState(true);

  useEffect(() => { void hydrate(); }, [hydrate]);
  useEffect(() => { document.documentElement.classList.toggle("dark", dark); }, [dark]);
  useEffect(() => { if (error) toast.error(error); }, [error]);

  const run = (label: string, promise: Promise<unknown>) => toast.promise(promise, { loading: label, success: `${label} requested`, error: (e) => e.message });
  const connected = state === "connected";
  return <div className={`app-shell ${sidebar ? "" : "sidebar-hidden"}`}>
    {sidebar && <InstanceSidebar />}
    <main>
      <header className="topbar">
        <button className="icon-button" onClick={() => setSidebar((v) => !v)} title="Toggle sidebar"><PanelLeft size={17} /></button>
        <div className="session-heading"><strong>{session.sessionName || "Remote Pi session"}</strong><span>{session.cwd || "No instance selected"}</span></div>
        <div className={`connection-pill ${state}`}><i />{state}{detail && <span> · {detail}</span>}</div>
        <div className="top-actions">
          <label className="select-control"><Sparkles size={15} /><select disabled={!connected} value={session.model ? `${session.model.provider}/${session.model.id}` : ""} onChange={(e) => { const [provider, ...rest] = e.target.value.split("/"); run("Switch model", command({ type: "set_model", provider, modelId: rest.join("/") })); }}><option value="">Model</option>{session.availableModels.map((m) => <option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>{m.name || m.id}</option>)}</select><ChevronDown size={13} /></label>
          <label className="select-control"><Brain size={15} /><select disabled={!connected} value={session.thinkingLevel} onChange={(e) => run("Thinking level", command({ type: "set_thinking", level: e.target.value as any }))}>{["off", "minimal", "low", "medium", "high", "xhigh"].map((v) => <option key={v}>{v}</option>)}</select><ChevronDown size={13} /></label>
          <button disabled={!connected} className={session.planPhase !== "idle" ? "active-control" : ""} onClick={() => run("Plan mode", command({ type: "set_plan_mode", mode: session.planPhase === "idle" ? "enter" : "exit" }))}><Zap size={15} /> Plan</button>
          <button disabled={!connected || Boolean(review)} onClick={() => run("Code review", command({ type: "start_code_review" }))}><Code2 size={15} /> Review changes</button>
          <button disabled={!connected || session.isRunning} onClick={() => run("Compact", command({ type: "compact" }))}>Compact</button>
          <button className="icon-button" onClick={() => setDark((v) => !v)} title="Toggle theme">{dark ? <Sun size={16} /> : <Moon size={16} />}</button>
        </div>
      </header>
      {state !== "connected" && <div className="offline-banner"><Unplug size={15} />{state === "connecting" ? "Connecting to Pi…" : "Pi is offline. Messages and controls are disabled until the connection returns."}</div>}
      {review && <nav className="view-tabs"><button className={!review.visible ? "active" : ""} onClick={() => showReview(false)}>Chat</button><button className={review.visible ? "active" : ""} onClick={() => showReview(true)}><span className="review-pulse" />Review</button></nav>}
      <section className="workspace">
        {review?.visible ? <ReviewPanel /> : <PiRuntimeProvider><Thread /></PiRuntimeProvider>}
      </section>
    </main>
    <Toaster richColors position="bottom-right" theme={dark ? "dark" : "light"} />
  </div>;
}
