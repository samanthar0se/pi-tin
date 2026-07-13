import { useState } from "react";
import { Pencil, Plus, Server, Trash2, X } from "lucide-react";
import { useAppStore } from "../remote/store";
import type { HostProfile } from "../remote/connection";

const blank = (): HostProfile => ({ id: crypto.randomUUID(), name: "", host: "", controlPort: 31415, plannotatorPort: 19432, token: "" });

export function InstanceSidebar() {
  const profiles = useAppStore((s) => s.profiles);
  const active = useAppStore((s) => s.activeProfileId);
  const activate = useAppStore((s) => s.activate);
  const save = useAppStore((s) => s.saveProfile);
  const remove = useAppStore((s) => s.removeProfile);
  const state = useAppStore((s) => s.connectionState);
  const [editing, setEditing] = useState<HostProfile | null>(null);
  return <aside className="sidebar">
    <div className="sidebar-title"><div className="brand-mark">π</div><strong>Pi Remote</strong><button onClick={() => setEditing(blank())} title="Add instance"><Plus size={17} /></button></div>
    <div className="instance-list">{profiles.map((profile) => <button key={profile.id} className={`instance ${active === profile.id ? "active" : ""}`} onClick={() => activate(profile.id)}>
      <span className={`status-dot ${active === profile.id ? state : ""}`} /><Server size={16} /><span><strong>{profile.name}</strong><small>{profile.host}:{profile.controlPort}</small></span>
      <i onClick={(event) => { event.stopPropagation(); setEditing({ ...profile }); }} title="Edit"><Pencil size={14} /></i>
    </button>)}</div>
    {!profiles.length && <div className="sidebar-empty">Add the Pi process you started on another machine.</div>}
    <div className="sidebar-foot">Trusted LAN only</div>
    {editing && <div className="dialog-backdrop" onMouseDown={() => setEditing(null)}><form className="profile-dialog" onMouseDown={(e) => e.stopPropagation()} onSubmit={(event) => { event.preventDefault(); void save(editing).then(() => { setEditing(null); activate(editing.id); }); }}>
      <header><strong>{profiles.some((p) => p.id === editing.id) ? "Edit instance" : "Add instance"}</strong><button type="button" onClick={() => setEditing(null)}><X size={17} /></button></header>
      <label>Name<input required value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Office workstation" /></label>
      <label>Host or IP<input required value={editing.host} onChange={(e) => setEditing({ ...editing, host: e.target.value })} placeholder="192.168.1.20" /></label>
      <div className="field-row"><label>Control port<input required type="number" value={editing.controlPort} onChange={(e) => setEditing({ ...editing, controlPort: Number(e.target.value) })} /></label><label>Review port<input required type="number" value={editing.plannotatorPort} onChange={(e) => setEditing({ ...editing, plannotatorPort: Number(e.target.value) })} /></label></div>
      <label>Pre-shared token<input required type="password" value={editing.token} onChange={(e) => setEditing({ ...editing, token: e.target.value })} /></label>
      <p>The token is stored in local app data. Plannotator's transient review port is not authenticated.</p>
      <footer>{profiles.some((p) => p.id === editing.id) && <button className="danger" type="button" onClick={() => void remove(editing.id).then(() => setEditing(null))}><Trash2 size={15} /> Delete</button>}<span /><button type="button" onClick={() => setEditing(null)}>Cancel</button><button className="primary" type="submit">Save & connect</button></footer>
    </form></div>}
  </aside>;
}
