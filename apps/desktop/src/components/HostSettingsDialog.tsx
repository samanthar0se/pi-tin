import { useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import type { HostProfile } from "../remote/connection";
import { useAppStore } from "../remote/store";

const blank = (): HostProfile => ({ id: crypto.randomUUID(), name: "", host: "", controlPort: 31415, plannotatorPort: 19432, token: "" });

export function HostSettingsDialog({ onClose }: { onClose: () => void }) {
  const profiles = useAppStore((s) => s.profiles);
  const save = useAppStore((s) => s.saveProfile);
  const remove = useAppStore((s) => s.removeProfile);
  const activate = useAppStore((s) => s.activate);
  const [editing, setEditing] = useState<HostProfile>(() => profiles[0] ? { ...profiles[0] } : blank());
  const exists = profiles.some((profile) => profile.id === editing.id);
  return <div className="dialog-backdrop" onMouseDown={onClose}><form className="profile-dialog" onMouseDown={(e) => e.stopPropagation()} onSubmit={(event) => {
    event.preventDefault(); void save(editing).then(() => { activate(editing.id); onClose(); });
  }}>
    <header><strong>Host settings</strong><button type="button" onClick={onClose}><X size={17} /></button></header>
    {profiles.length > 0 && <label>Saved host<select value={exists ? editing.id : "new"} onChange={(e) => {
      if (e.target.value === "new") setEditing(blank());
      else setEditing({ ...profiles.find((profile) => profile.id === e.target.value)! });
    }}>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}<option value="new">+ Add host</option></select></label>}
    {!profiles.length && <button type="button" className="add-host-label" onClick={() => setEditing(blank())}><Plus size={14} /> Add your first host</button>}
    <label>Name<input required value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Office workstation" /></label>
    <label>Host or IP<input required value={editing.host} onChange={(e) => setEditing({ ...editing, host: e.target.value })} placeholder="192.168.1.20" /></label>
    <div className="field-row"><label>Control port<input required type="number" value={editing.controlPort} onChange={(e) => setEditing({ ...editing, controlPort: Number(e.target.value) })} /></label><label>Review port<input required type="number" value={editing.plannotatorPort} onChange={(e) => setEditing({ ...editing, plannotatorPort: Number(e.target.value) })} /></label></div>
    <label>Generated token<input required type="password" value={editing.token} onChange={(e) => setEditing({ ...editing, token: e.target.value })} /></label>
    <p>Copy the token printed by `start-host.mjs`. Plannotator's transient review port remains unauthenticated.</p>
    <footer>{exists && <button className="danger" type="button" onClick={() => void remove(editing.id).then(onClose)}><Trash2 size={15} /> Delete</button>}<span /><button type="button" onClick={onClose}>Cancel</button><button className="primary" type="submit">Save & connect</button></footer>
  </form></div>;
}
