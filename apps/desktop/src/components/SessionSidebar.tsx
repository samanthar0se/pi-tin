import { useMemo, useState } from "react";
import { LoaderCircle, MessageSquare, Plus, X } from "lucide-react";
import type { SessionItem } from "@pi-remote/protocol";
import { toast } from "sonner";
import { useAppStore } from "../remote/store";

function group(session: SessionItem): "Today" | "Previous 7 Days" | "Older" {
  const age = Date.now() - new Date(session.modifiedAt).getTime();
  if (age < 86_400_000) return "Today";
  if (age < 7 * 86_400_000) return "Previous 7 Days";
  return "Older";
}
function relative(value: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60); if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export function SessionSidebar() {
  const sessions = useAppStore((s) => s.sessions);
  const activeId = useAppStore((s) => s.activeSessionId);
  const switchingId = useAppStore((s) => s.switchingSessionId);
  const connected = useAppStore((s) => s.connectionState === "connected");
  const command = useAppStore((s) => s.command);
  const [newOpen, setNewOpen] = useState(false);
  const grouped = useMemo(() => ["Today", "Previous 7 Days", "Older"].map((label) => ({ label, sessions: sessions.filter((session) => group(session) === label) })).filter((item) => item.sessions.length), [sessions]);
  const projects = useMemo(() => [...new Map(sessions.filter((s) => s.cwd).map((s) => [s.cwd, s.project])).entries()], [sessions]);
  return <aside className="sidebar session-sidebar">
    <div className="sidebar-title"><div className="brand-mark">π</div><strong>Sessions</strong><button disabled={!connected} onClick={() => setNewOpen(true)} title="New session"><Plus size={17} /></button></div>
    <div className="session-list">{grouped.map((section) => <section key={section.label}><h3>{section.label}</h3>{section.sessions.map((session) => <button key={session.id} className={`session-row ${session.id === activeId ? "active" : ""}`} disabled={!connected || Boolean(switchingId)} onClick={() => void command({ type: "switch_session", sessionId: session.id }).catch((error) => toast.error(error.message))}>
      {switchingId === session.id ? <LoaderCircle className="spin" size={14} /> : <MessageSquare size={14} />}
      <span><strong>{session.name}</strong><small>{session.project} · {relative(session.modifiedAt)}</small></span>
      {(session.running || session.reviewing) && <i className={session.reviewing ? "reviewing" : "running"} />}
    </button>)}</section>)}</div>
    {!sessions.length && <div className="sidebar-empty">Connect to a host to load its Pi sessions.</div>}
    <div className="sidebar-foot">One active session</div>
    {newOpen && <div className="dialog-backdrop" onMouseDown={() => setNewOpen(false)}><div className="new-session-dialog" onMouseDown={(e) => e.stopPropagation()}><header><strong>New session</strong><button onClick={() => setNewOpen(false)}><X size={16} /></button></header><p>Choose a known project directory.</p>{projects.map(([cwd, name]) => <button key={cwd} onClick={() => { setNewOpen(false); void command({ type: "new_session", cwd }).catch((error) => toast.error(error.message)); }}><strong>{name}</strong><small>{cwd}</small></button>)}</div></div>}
  </aside>;
}
