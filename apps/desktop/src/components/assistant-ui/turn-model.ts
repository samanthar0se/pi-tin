export type TurnPart = {
  type?: string;
  text?: string;
  toolCallId?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  argsText?: string;
  result?: unknown;
  isError?: boolean;
  isRunning?: boolean;
};

export type ActivityKind = "shell" | "read" | "edit" | "search" | "web" | "generic";
export type ActivityStatus = "running" | "complete" | "error";

export type ActivityViewModel = {
  id: string;
  partIndex: number;
  kind: ActivityKind;
  status: ActivityStatus;
  summary: string;
  detailSummary?: string;
  toolName: string;
  args: Record<string, unknown>;
  argsText?: string;
  result?: unknown;
  isError: boolean;
};

export type WorkItem =
  | { id: string; kind: "progress" | "reasoning"; partIndex: number; pending: boolean }
  | { id: string; kind: "activity"; partIndex: number; activity: ActivityViewModel }
  | { id: string; kind: "activity-group"; activities: ActivityViewModel[] };

export type WorkStatus = "running" | "complete" | "error" | "cancelled";

export type TurnRenderModel = {
  work: {
    startedAtMs?: number;
    completedAtMs?: number;
    status: WorkStatus;
    items: WorkItem[];
  } | null;
  answerParts: number[];
};

export type TurnModelOptions = {
  messageStatus?: { type?: string; reason?: string };
  startedAtMs?: number;
  completedAtMs?: number;
};

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringArg(args: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function truncate(value: string, maxLength = 72): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength - 1).trimEnd()}…`;
}

function humanizeToolName(toolName: string): string {
  const leaf = toolName.split(/[.:/]/).filter(Boolean).at(-1) ?? toolName;
  const words = leaf.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[-_]+/g, " ").trim();
  return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}` : "tool";
}

export function classifyActivity(toolName: string): ActivityKind {
  const name = toolName.toLowerCase().replaceAll("-", "_");
  if (["apply_patch", "edit", "write"].some((value) => name.includes(value))) return "edit";
  if (["web_search", "fetch_content", "get_search_content"].some((value) => name.includes(value))) return "web";
  if (["grep", "glob", "find", "search"].some((value) => name.includes(value))) return "search";
  if (["bash", "shell", "exec", "command", "terminal"].some((value) => name.includes(value))) return "shell";
  if (["read", "list"].some((value) => name.includes(value)) || /(^|[_.])ls$/.test(name)) return "read";
  return "generic";
}

function activityCopy(kind: ActivityKind, toolName: string, args: Record<string, unknown>, status: ActivityStatus) {
  const path = stringArg(args, ["path", "file_path", "filePath", "filename"]);
  const file = path ? basename(path) : undefined;
  const command = stringArg(args, ["command", "cmd", "script"]);
  const query = stringArg(args, ["query", "pattern", "text", "search"]);
  const url = stringArg(args, ["url", "uri"]);
  const failed = status === "error";
  const running = status === "running";

  if (kind === "shell") return {
    summary: failed ? "Failed to run a command" : running ? "Running a command" : "Ran a command",
    detailSummary: command ? `${running ? "Running" : failed ? "Tried" : "Ran"} ${truncate(command)}` : undefined,
  };
  if (kind === "read") return {
    summary: failed ? `Failed to read${file ? ` ${file}` : " files"}` : running ? `Reading${file ? ` ${file}` : " files"}` : `Read${file ? ` ${file}` : " files"}`,
    detailSummary: path,
  };
  if (kind === "edit") {
    const created = toolName.toLowerCase().split(/[.:/]/).at(-1) === "write";
    const verb = created ? "Create" : "Edit";
    return {
      summary: failed ? `Failed to ${verb.toLowerCase()}${file ? ` ${file}` : " files"}` : running ? `${created ? "Creating" : "Editing"}${file ? ` ${file}` : " files"}` : `${created ? "Created" : "Edited"}${file ? ` ${file}` : " files"}`,
      detailSummary: path,
    };
  }
  if (kind === "search") return {
    summary: failed ? "Search failed" : running ? (query ? `Searching for ${truncate(query, 48)}` : "Searching code") : (query ? `Searched for ${truncate(query, 48)}` : "Searched code"),
    detailSummary: query,
  };
  if (kind === "web") {
    let target: string | undefined;
    if (url) {
      try { target = new URL(url).host || url; } catch { target = truncate(url, 48); }
    }
    return {
      summary: failed ? "Web request failed" : running ? (target ? `Opening ${target}` : "Searching the web") : (target ? `Opened ${target}` : "Searched the web"),
      detailSummary: query ?? url,
    };
  }
  const label = humanizeToolName(toolName);
  return {
    summary: failed ? `Failed ${label}` : running ? `Using ${label}` : `Used ${label}`,
    detailSummary: undefined,
  };
}

export function createActivityViewModel(part: TurnPart, partIndex: number): ActivityViewModel {
  const toolName = part.toolName?.trim() || "tool";
  const args = objectValue(part.args);
  const status: ActivityStatus = part.isError ? "error" : part.isRunning === true || part.result === undefined ? "running" : "complete";
  const kind = classifyActivity(toolName);
  const copy = activityCopy(kind, toolName, args, status);
  return {
    id: part.toolCallId || `activity-${partIndex}`,
    partIndex,
    kind,
    status,
    ...copy,
    toolName,
    args,
    argsText: part.argsText,
    result: part.result,
    isError: Boolean(part.isError),
  };
}

function meaningfulPart(part: TurnPart): boolean {
  return part.type !== "text" || Boolean(part.text?.trim());
}

export function formatWorkText(value: string): string {
  return value
    .trim()
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, "")
    .replace(/\n{3,}/g, "\n\n");
}

function groupConsecutiveShellActivities(items: WorkItem[]): WorkItem[] {
  const grouped: WorkItem[] = [];
  for (let index = 0; index < items.length;) {
    const item = items[index]!;
    if (item.kind !== "activity" || item.activity.kind !== "shell") {
      grouped.push(item);
      index += 1;
      continue;
    }
    const activities: ActivityViewModel[] = [];
    while (index < items.length) {
      const candidate = items[index]!;
      if (candidate.kind !== "activity" || candidate.activity.kind !== "shell") break;
      activities.push(candidate.activity);
      index += 1;
    }
    grouped.push(activities.length === 1
      ? item
      : { id: `activity-group-${activities[0]!.id}`, kind: "activity-group", activities });
  }
  return grouped;
}

function workStatus(parts: readonly TurnPart[], options: TurnModelOptions, finalAnswerStarted: boolean): WorkStatus {
  const unfinishedTool = parts.some((part) => part.type === "tool-call" && (part.isRunning === true || part.result === undefined) && !part.isError);
  if (unfinishedTool || (options.messageStatus?.type === "running" && !finalAnswerStarted)) return "running";
  const reason = options.messageStatus?.reason?.toLowerCase() ?? "";
  if (["cancelled", "canceled", "abort", "aborted"].some((value) => reason.includes(value))) return "cancelled";
  if (parts.some((part) => part.type === "tool-call" && part.isError) || reason.includes("error")) return "error";
  return "complete";
}

export function createTurnRenderModel(parts: readonly TurnPart[], options: TurnModelOptions = {}): TurnRenderModel {
  let lastActivityIndex = -1;
  for (let index = parts.length - 1; index >= 0; index--) {
    if (parts[index]?.type === "reasoning" || parts[index]?.type === "tool-call") {
      lastActivityIndex = index;
      break;
    }
  }

  if (lastActivityIndex < 0) {
    const pendingEmptyTurn = parts.length === 0 && options.messageStatus?.type === "running";
    return {
      work: pendingEmptyTurn ? {
        startedAtMs: options.startedAtMs,
        completedAtMs: options.completedAtMs,
        status: "running",
        items: [],
      } : null,
      answerParts: parts.map((_, index) => index),
    };
  }

  const answerParts = parts
    .map((_, index) => index)
    .filter((index) => index > lastActivityIndex && meaningfulPart(parts[index]!));
  const status = workStatus(parts, options, answerParts.length > 0);
  const items: WorkItem[] = [];
  for (let partIndex = 0; partIndex <= lastActivityIndex; partIndex++) {
    const part = parts[partIndex]!;
    if (!meaningfulPart(part)) continue;
    if (part.type === "tool-call") {
      const activity = createActivityViewModel(part, partIndex);
      items.push({ id: activity.id, kind: "activity", partIndex, activity });
    } else {
      items.push({
        id: `${part.type === "reasoning" ? "reasoning" : "progress"}-${partIndex}`,
        kind: part.type === "reasoning" ? "reasoning" : "progress",
        partIndex,
        pending: status === "running" && partIndex === lastActivityIndex,
      });
    }
  }

  return {
    work: {
      startedAtMs: options.startedAtMs,
      completedAtMs: options.completedAtMs,
      status,
      items: groupConsecutiveShellActivities(items),
    },
    answerParts,
  };
}

export function formatWorkedDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
