import { useState } from "react";
import { FolderPlus, X } from "lucide-react";
import { useAppStore } from "../remote/store";

export function NewSessionDialog({ onClose }: { onClose: () => void }) {
  const currentCwd = useAppStore((state) => state.session.cwd);
  const createSession = useAppStore((state) => state.createSession);
  const [cwd, setCwd] = useState(currentCwd);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string>();

  return <div className="dialog-backdrop" onMouseDown={onClose}>
    <form className="profile-dialog session-dialog" onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => {
      event.preventDefault();
      setCreating(true);
      setError(undefined);
      void createSession(cwd.trim()).then(onClose).catch((caught) => {
        setError(caught instanceof Error ? caught.message : "Could not create the Pi session.");
        setCreating(false);
      });
    }}>
      <header><strong>New Pi session</strong><button type="button" onClick={onClose}><X size={17} /></button></header>
      <label>Working directory on the Pi host<input autoFocus required value={cwd} onChange={(event) => setCwd(event.target.value)} placeholder="C:\\git\\project or /home/user/project" /></label>
      <p>Enter an existing absolute directory on the remote host. The session keeps this working directory for its lifetime.</p>
      {error && <p className="session-dialog-error">{error}</p>}
      <footer><span /><button type="button" onClick={onClose}>Cancel</button><button className="primary" type="submit" disabled={creating || !cwd.trim()}><FolderPlus size={15} />{creating ? "Opening…" : "Open session"}</button></footer>
    </form>
  </div>;
}
