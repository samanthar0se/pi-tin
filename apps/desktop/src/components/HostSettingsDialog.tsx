import { useState } from "react";
import { RotateCcw, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import type { HostProfile } from "../remote/connection";
import { useAppStore } from "../remote/store";
import { useDialogFocus } from "./use-dialog-focus";

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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const { dialogRef, trapFocus } = useDialogFocus<HTMLFormElement>();

  const restartPi = async () => {
    if (!window.confirm("Restart the selected Pi runtime? Its active response will stop, and its current session will be restored.")) return;
    setRestarting(true);
    try {
      await command({ type: "restart_pi" }, 120_000);
      toast.success("Pi restarted on the host");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not restart Pi");
    } finally {
      setRestarting(false);
    }
  };

  return <div className="dialog-backdrop" onMouseDown={() => { if (!saving) onClose(); }}><form ref={dialogRef} className="profile-dialog" role="dialog" aria-modal="true" aria-labelledby="connection-settings-title" onKeyDown={(event) => { trapFocus(event); if (event.key === "Escape" && !saving) onClose(); }} onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => {
    event.preventDefault();
    const normalized = { ...editing, host: editing.host.trim(), token: editing.token.trim() };
    if (!normalized.host || !normalized.token) {
      setError("Enter both the Pi host and its generated token.");
      return;
    }
    if (![normalized.controlPort, normalized.plannotatorPort].every((port) => Number.isInteger(port) && port >= 1 && port <= 65_535)) {
      setError("Ports must be whole numbers between 1 and 65535.");
      return;
    }
    setSaving(true);
    setError(undefined);
    void save(normalized).then(onClose).catch((caught) => {
      setError(caught instanceof Error ? caught.message : "Could not save the connection.");
      setSaving(false);
    });
  }}>
    <header><strong id="connection-settings-title">Connection settings</strong><button type="button" aria-label="Close Connection settings" disabled={saving} onClick={onClose}><X size={17} /></button></header>
    <label>Host or IP<input data-dialog-autofocus required value={editing.host} onChange={(event) => setEditing({ ...editing, host: event.target.value })} placeholder="192.168.1.20" /></label>
    <div className="field-row"><label>Control port<input required type="number" min="1" max="65535" step="1" value={editing.controlPort} onChange={(event) => setEditing({ ...editing, controlPort: Number(event.target.value) })} /></label><label>Review port<input required type="number" min="1" max="65535" step="1" value={editing.plannotatorPort} onChange={(event) => setEditing({ ...editing, plannotatorPort: Number(event.target.value) })} /></label></div>
    <label>Generated token<input required type="password" value={editing.token} onChange={(event) => setEditing({ ...editing, token: event.target.value })} /></label>
    <p>Copy the token printed by `start-host.mjs`. Saving replaces the single configured connection.</p>
    {error && <p className="session-dialog-error" role="alert">{error}</p>}
    {profile && <div className="host-control"><div><strong>Selected Pi runtime</strong><span>Restart the selected Pi process and restore its current session.</span></div><button type="button" disabled={!connected || rpcStatus === "starting" || restarting} onClick={() => void restartPi()}><RotateCcw className={restarting ? "spin" : undefined} size={15} />{restarting ? "Restarting…" : rpcStatus === "error" ? "Retry Pi" : "Restart Pi"}</button></div>}
    <p className="build-revision">Desktop build {buildRevision}</p>
    <footer>{profile && <button className="danger" type="button" disabled={saving} onClick={() => { if (window.confirm("Remove this Pi host connection?")) void clear().then(onClose); }}><Trash2 size={15} /> Remove connection</button>}<span /><button type="button" disabled={saving} onClick={onClose}>Cancel</button><button className="primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save & connect"}</button></footer>
  </form></div>;
}
