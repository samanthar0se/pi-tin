import { useState } from "react";
import { CheckCircle2, ChevronDown, CircleAlert, LoaderCircle, Wrench } from "lucide-react";

export function ToolCard({ toolName, argsText, result, isError }: { toolName: string; argsText?: string; result?: unknown; isError?: boolean }) {
  const [open, setOpen] = useState(Boolean(isError));
  const running = result === undefined;
  return (
    <div className={`tool-card ${isError ? "error" : ""}`}>
      <button className="tool-trigger" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        {running ? <LoaderCircle className="spin" size={15} /> : isError ? <CircleAlert size={15} /> : <CheckCircle2 size={15} />}
        <Wrench size={14} /><span>{toolName}</span><span className="tool-status">{running ? "Running" : isError ? "Failed" : "Done"}</span>
        <ChevronDown className={open ? "rotate" : ""} size={15} />
      </button>
      {open && <div className="tool-details">
        {argsText && <><label>Input</label><pre>{argsText}</pre></>}
        {result !== undefined && <><label>Output</label><pre>{typeof result === "string" ? result : JSON.stringify(result, null, 2)}</pre></>}
      </div>}
    </div>
  );
}
