import { useEffect, useState } from "react";
import { Check, ChevronRight, Copy, FilePenLine, FileSearch, Globe2, Search, Terminal, Wrench } from "lucide-react";
import { createActivityViewModel, type ActivityKind } from "./turn-model";

type ToolCardProps = {
  toolCallId?: string;
  toolName: string;
  args?: Record<string, unknown>;
  argsText?: string;
  result?: unknown;
  isError?: boolean;
  isRunning?: boolean;
};

function ActivityIcon({ kind }: { kind: ActivityKind }) {
  if (kind === "shell") return <Terminal />;
  if (kind === "edit") return <FilePenLine />;
  if (kind === "read") return <FileSearch />;
  if (kind === "search") return <Search />;
  if (kind === "web") return <Globe2 />;
  return <Wrench />;
}

function textValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

function argValue(args: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return <button type="button" className="detail-copy" title={label} aria-label={label} onClick={(event) => {
    event.stopPropagation();
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    });
  }}>{copied ? <Check /> : <Copy />}</button>;
}

function ShellActivityDetail({ args, argsText, result }: Pick<ToolCardProps, "args" | "argsText" | "result">) {
  const command = argValue(args ?? {}, ["command", "cmd", "script"]) ?? argsText ?? "";
  const output = textValue(result);
  return <div className="activity-detail terminal-detail">
    <header><span>Shell</span><CopyButton value={[command && `$ ${command}`, output].filter(Boolean).join("\n")} label="Copy command output" /></header>
    <pre>{command && <code className="terminal-command">$ {command}{output && "\n"}</code>}{output}</pre>
  </div>;
}

function ReadActivityDetail({ args, argsText, result }: Pick<ToolCardProps, "args" | "argsText" | "result">) {
  const path = argValue(args ?? {}, ["path", "file_path", "filePath", "filename"]);
  const output = textValue(result);
  return <div className="activity-detail document-detail">
    <header><span title={path}>{path ?? "Read output"}</span>{output && <CopyButton value={output} label="Copy read output" />}</header>
    {output ? <pre>{output}</pre> : argsText && <pre>{argsText}</pre>}
  </div>;
}

function EditActivityDetail({ args, argsText, result }: Pick<ToolCardProps, "args" | "argsText" | "result">) {
  const path = argValue(args ?? {}, ["path", "file_path", "filePath", "filename"]);
  const output = textValue(result);
  return <div className="activity-detail edit-detail">
    <header><span title={path}>{path ?? "File changes"}</span>{output && <CopyButton value={output} label="Copy edit output" />}</header>
    {(output || argsText) && <pre>{output || argsText}</pre>}
  </div>;
}

function GenericActivityDetail({ argsText, result, title = "Details" }: Pick<ToolCardProps, "argsText" | "result"> & { title?: string }) {
  const output = textValue(result);
  if (!argsText && !output) return null;
  return <div className="activity-detail generic-detail">
    <header><span>{title}</span><CopyButton value={[argsText, output].filter(Boolean).join("\n\n")} label="Copy tool details" /></header>
    {argsText && <section><span>Input</span><pre>{argsText}</pre></section>}
    {output && <section><span>Output</span><pre>{output}</pre></section>}
  </div>;
}

function ActivityDetail({ kind, ...props }: ToolCardProps & { kind: ActivityKind }) {
  if (kind === "shell") return <ShellActivityDetail {...props} />;
  if (kind === "read") return <ReadActivityDetail {...props} />;
  if (kind === "edit") return <EditActivityDetail {...props} />;
  return <GenericActivityDetail {...props} title={kind === "search" ? "Search" : kind === "web" ? "Web" : "Details"} />;
}

export function ToolCard(props: ToolCardProps) {
  const [open, setOpen] = useState(Boolean(props.isError));
  useEffect(() => { if (props.isError) setOpen(true); }, [props.isError]);
  const activity = createActivityViewModel({ ...props, result: props.isRunning ? undefined : props.result }, 0);
  const hasDetail = Boolean(activity.detailSummary || props.argsText || props.result !== undefined);
  return <div className={`activity-item ${activity.status} ${open ? "open" : ""}`}>
    <button type="button" className="activity-trigger" disabled={!hasDetail} onClick={() => setOpen((value) => !value)} aria-expanded={hasDetail ? open : undefined}>
      <ActivityIcon kind={activity.kind} />
      <span className={activity.status === "running" ? "cadenced-shimmer" : undefined}>{activity.summary}</span>
      {hasDetail && <ChevronRight className="activity-chevron" />}
    </button>
    {open && <div className="activity-detail-wrap">
      {activity.detailSummary && <div className="activity-detail-summary" title={activity.detailSummary}>{activity.detailSummary}</div>}
      <ActivityDetail {...props} kind={activity.kind} />
    </div>}
  </div>;
}
