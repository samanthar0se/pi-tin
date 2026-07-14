import { useState } from "react";
import { RotateCcw, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import type { HostProfile } from "../remote/connection";
import { useAppStore } from "../remote/store";

const blank = (): HostProfile => ({ host: "", controlPort: 31415, plannotatorPort: 19432, token: "" });
const buildRevision = import.meta.env.VITE_BUILD_REVISION || "development";

export function HostSettingsDialog({ onClose }: { onClose: () => void }) {
  const profile = useAppStore((state) => state.profile);
  const save = useAppStore((state) => state.saveProfile);
  const clear = useAppStore((state) => state.clearProfile);
  const command = useAppStore((state) => state.command);
  const connected = useAppStore((state) => state.connectionState === "connected");
  const rpcStatus = useAppStore((state) => state.rpcStatus);
  const [editing, setEditing] = useState<HostProfile>(() => profile ? { ...profile } : blank());
  const [restarting, setRestarting] = useState(false);

  const restartPi = async () => {
    if (!window.confirm("Restart the selected Pi runtime? Its active response will stop, and its current session will be restored.")) return;
    setRestarting(true);
    try {
      await command({ type: "restart_pi" }, 30_000);
      toast.success("Pi restarted on the host");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not restart Pi");
    } finally {
      setRestarting(false);
    }
  };

  return <div className="dialog-backdrop" onMouseDown={onClose}><form className="profile-dialog" onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => {
    event.preventDefault();
    void save(editing).then(onClose);
  }}>
    <header><strong>Connection settings</strong><button type="button" onClick={onClose}><X size={17} /></button></header>
    <label>Host or IP<input required value={editing.host} onChange={(event) => setEditing({ ...editing, host: event.target.value })} placeholder="192.168.1.20" /></label>
    <div className="field-row"><label>Control port<input required type="number" value={editing.controlPort} onChange={(event) => setEditing({ ...editing, controlPort: Number(event.target.value) })} /></label><label>Review port<input required type="number" value={editing.plannotatorPort} onChange={(event) => setEditing({ ...editing, plannotatorPort: Number(event.target.value) })} /></label></div>
    <label>Generated token<input required type="password" value={editing.token} onChange={(event) => setEditing({ ...editing, token: event.target.value })} /></label>
    <p>Copy the token printed by `start-host.mjs`. Saving replaces the single configured connection.</p>
    {profile && <div className="host-control"><div><strong>Selected Pi runtime</strong><span>Restart the selected Pi process and restore its current session.</span></div><button type="button" disabled={!connected || rpcStatus !== "ready" || restarting} onClick={() => void restartPi()}><RotateCcw className={restarting ? "spin" : undefined} size={15} />{restarting ? "Restarting…" : "Restart Pi"}</button></div>}
    <p className="build-revision">Desktop build {buildRevision}</p>
    <footer>{profile && <button className="danger" type="button" onClick={() => void clear().then(onClose)}><Trash2 size={15} /> Remove connection</button>}<span /><button type="button" onClick={onClose}>Cancel</button><button className="primary" type="submit">Save & connect</button></footer>
  </form></div>;
}
