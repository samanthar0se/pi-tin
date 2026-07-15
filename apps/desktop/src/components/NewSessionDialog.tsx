import { useState } from "react";
import { FolderPlus, X } from "lucide-react";
import { useAppStore } from "../remote/store";
import { useDialogFocus } from "./use-dialog-focus";

export function NewSessionDialog({ onClose }: { onClose: () => void }) {
  const currentCwd = useAppStore((state) => state.session.cwd);
  const createSession = useAppStore((state) => state.createSession);
  const [cwd, setCwd] = useState(currentCwd);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string>();
  const { dialogRef, trapFocus } = useDialogFocus<HTMLFormElement>();

  return <div className="dialog-backdrop" onMouseDown={() => { if (!creating) onClose(); }}>
    <form ref={dialogRef} className="profile-dialog session-dialog" role="dialog" aria-modal="true" aria-labelledby="open-workspace-title" onKeyDown={(event) => { trapFocus(event); if (event.key === "Escape" && !creating) onClose(); }} onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => {
      event.preventDefault();
      setCreating(true);
      setError(undefined);
      void createSession(cwd.trim()).then(onClose).catch((caught) => {
        setError(caught instanceof Error ? caught.message : "Could not create the Pi session.");
        setCreating(false);
      });
    }}>
      <header><strong id="open-workspace-title">Open workspace</strong><button type="button" aria-label="Close Open workspace" disabled={creating} onClick={onClose}><X size={17} /></button></header>
      <label>Working directory on the Pi host<input data-dialog-autofocus required value={cwd} onChange={(event) => setCwd(event.target.value)} placeholder="C:\\git\\project or /home/user/project" /></label>
      <p>Enter an existing absolute directory on the remote host. The session keeps this working directory for its lifetime.</p>
      {error && <p className="session-dialog-error" role="alert">{error}</p>}
      <footer><span /><button type="button" disabled={creating} onClick={onClose}>Cancel</button><button className="primary" type="submit" disabled={creating || !cwd.trim()}><FolderPlus size={15} />{creating ? "Opening…" : "Open workspace"}</button></footer>
    </form>
  </div>;
}
