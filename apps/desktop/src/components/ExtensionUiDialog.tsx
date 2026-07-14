import { useEffect, useRef, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import type { ExtensionUiRequest } from "@pi-tin/protocol";
import { useAppStore } from "../remote/store";

export function ExtensionUiDialog({ request }: { request: ExtensionUiRequest }) {
  const respond = useAppStore((state) => state.respondToExtensionUi);
  const [value, setValue] = useState(request.prefill ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const fieldRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    setValue(request.prefill ?? "");
    setSubmitting(false);
    setError(undefined);
    queueMicrotask(() => fieldRef.current?.focus());
  }, [request.id, request.prefill]);

  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || submitting) return;
      event.preventDefault();
      void submit({ cancelled: true });
    };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  });

  const submit = async (response: { value?: string; confirmed?: boolean; cancelled?: boolean }) => {
    setSubmitting(true);
    setError(undefined);
    try { await respond(response); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not send the response"); }
    finally { setSubmitting(false); }
  };
  const submitValue = (event: FormEvent) => {
    event.preventDefault();
    void submit({ value });
  };

  return <div className="dialog-backdrop extension-ui-backdrop" role="presentation">
    <section className="extension-ui-dialog" role="dialog" aria-modal="true" aria-labelledby={`extension-ui-title-${request.id}`}>
      <header>
        <strong id={`extension-ui-title-${request.id}`}>{request.method === "confirm" ? request.title || "Confirm" : "Pi needs your input"}</strong>
        <button disabled={submitting} onClick={() => void submit({ cancelled: true })} title="Cancel"><X size={17} /></button>
      </header>
      {request.method !== "confirm" && request.title && <div className="extension-ui-question">{request.title}</div>}
      {request.method === "confirm" && request.message && <div className="extension-ui-question">{request.message}</div>}
      {error && <p className="extension-ui-error">{error}</p>}

      {request.method === "select" && <div className="extension-ui-options">
        {(request.options ?? []).map((option) => <button key={option} disabled={submitting} onClick={() => void submit({ value: option })}>{option}</button>)}
      </div>}

      {(request.method === "input" || request.method === "editor") && <form onSubmit={submitValue}>
        {request.method === "editor"
          ? <textarea ref={(node) => { fieldRef.current = node; }} value={value} onChange={(event) => setValue(event.target.value)} placeholder={request.placeholder} rows={10} />
          : <input ref={(node) => { fieldRef.current = node; }} value={value} onChange={(event) => setValue(event.target.value)} placeholder={request.placeholder} />}
        <footer><span /><button type="button" disabled={submitting} onClick={() => void submit({ cancelled: true })}>Cancel</button><button className="primary" disabled={submitting} type="submit">Submit</button></footer>
      </form>}

      {request.method === "confirm" && <footer><span /><button disabled={submitting} onClick={() => void submit({ confirmed: false })}>No</button><button className="primary" disabled={submitting} onClick={() => void submit({ confirmed: true })}>Yes</button></footer>}
    </section>
  </div>;
}
