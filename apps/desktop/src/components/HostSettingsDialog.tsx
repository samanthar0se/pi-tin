import { useState } from "react";
import { Trash2, X } from "lucide-react";
import type { HostProfile } from "../remote/connection";
import { useAppStore } from "../remote/store";

const blank = (): HostProfile => ({ host: "", controlPort: 31415, plannotatorPort: 19432, token: "" });
const buildRevision = import.meta.env.VITE_BUILD_REVISION || "development";

export function HostSettingsDialog({ onClose }: { onClose: () => void }) {
  const profile = useAppStore((state) => state.profile);
  const save = useAppStore((state) => state.saveProfile);
  const clear = useAppStore((state) => state.clearProfile);
  const [editing, setEditing] = useState<HostProfile>(() => profile ? { ...profile } : blank());

  return <div className="dialog-backdrop" onMouseDown={onClose}><form className="profile-dialog" onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => {
    event.preventDefault();
    void save(editing).then(onClose);
  }}>
    <header><strong>Connection settings</strong><button type="button" onClick={onClose}><X size={17} /></button></header>
    <label>Host or IP<input required value={editing.host} onChange={(event) => setEditing({ ...editing, host: event.target.value })} placeholder="192.168.1.20" /></label>
    <div className="field-row"><label>Control port<input required type="number" value={editing.controlPort} onChange={(event) => setEditing({ ...editing, controlPort: Number(event.target.value) })} /></label><label>Review port<input required type="number" value={editing.plannotatorPort} onChange={(event) => setEditing({ ...editing, plannotatorPort: Number(event.target.value) })} /></label></div>
    <label>Generated token<input required type="password" value={editing.token} onChange={(event) => setEditing({ ...editing, token: event.target.value })} /></label>
    <p>Copy the token printed by `start-host.mjs`. Saving replaces the single configured connection.</p>
    <p className="build-revision">Desktop build {buildRevision}</p>
    <footer>{profile && <button className="danger" type="button" onClick={() => void clear().then(onClose)}><Trash2 size={15} /> Remove connection</button>}<span /><button type="button" onClick={onClose}>Cancel</button><button className="primary" type="submit">Save & connect</button></footer>
  </form></div>;
}
