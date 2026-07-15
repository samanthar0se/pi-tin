import { AssistantRuntimeProvider, useExternalStoreRuntime, type ThreadMessageLike } from "@assistant-ui/react";
import { Thread } from "./Thread";

const startedAtMs = Date.now() - 5_500;

const userMessage = (text: string): ThreadMessageLike => ({
  id: "fixture-user",
  role: "user",
  content: [{ type: "text", text }],
  createdAt: new Date(startedAtMs - 1_000),
});

const fixtures: Record<string, ThreadMessageLike[]> = {
  empty: [],
  prompt: [userMessage("Please inspect the renderer and explain what should change.")],
  running: [
    userMessage("Bring this chat closer to the current Codex app."),
    {
      id: "fixture-running",
      role: "assistant",
      content: [
        { type: "text", text: "I’m checking the current thread structure and visual tokens." },
        { type: "tool-call", toolCallId: "fixture-read", toolName: "read", args: { path: "apps/desktop/src/components/assistant-ui/Thread.tsx" }, argsText: "{\n  \"path\": \"apps/desktop/src/components/assistant-ui/Thread.tsx\"\n}", result: "import { ThreadPrimitive } from \"@assistant-ui/react\";", isRunning: false },
        { type: "text", text: "The hierarchy is clear. Next I’m validating the focused renderer tests." },
        { type: "tool-call", toolCallId: "fixture-shell", toolName: "bash", args: { command: "corepack pnpm vitest run turn-model.test.ts" }, argsText: "{\n  \"command\": \"corepack pnpm vitest run turn-model.test.ts\"\n}", result: "RUN v3.2.7\nTests 9 passed", isRunning: true },
      ],
      status: { type: "running" },
      createdAt: new Date(startedAtMs),
      metadata: { custom: { startedAtMs } },
    } as ThreadMessageLike,
  ],
  completed: [
    userMessage("Bring this chat closer to the current Codex app."),
    {
      id: "fixture-complete",
      role: "assistant",
      content: [
        { type: "text", text: "I reviewed the existing hierarchy first." },
        { type: "tool-call", toolCallId: "fixture-command", toolName: "bash", args: { command: "corepack pnpm vitest run turn-model.test.ts" }, argsText: "{\n  \"command\": \"corepack pnpm vitest run turn-model.test.ts\"\n}", result: "Tests 9 passed", isRunning: false },
        { type: "text", text: "The fidelity pass now uses one turn-level work disclosure with ordered semantic activity rows.\n\n- Final answers remain visible when work is collapsed.\n- Tool details stay available on demand.\n- The composer keeps Pi-specific controls without dominating the layout." },
      ],
      status: { type: "complete", reason: "stop" },
      createdAt: new Date(startedAtMs),
      metadata: { custom: { startedAtMs, completedAtMs: startedAtMs + 5_200 } },
    } as ThreadMessageLike,
  ],
  error: [
    userMessage("Read the missing configuration file."),
    {
      id: "fixture-error",
      role: "assistant",
      content: [
        { type: "tool-call", toolCallId: "fixture-error-tool", toolName: "read", args: { path: "missing.json" }, argsText: "{\n  \"path\": \"missing.json\"\n}", result: "File not found", isError: true, isRunning: false },
        { type: "text", text: "I couldn’t read `missing.json` because it does not exist." },
      ],
      status: { type: "incomplete", reason: "error" },
      createdAt: new Date(startedAtMs),
      metadata: { custom: { startedAtMs, completedAtMs: startedAtMs + 1_800 } },
    } as ThreadMessageLike,
  ],
  code: [
    userMessage("Show a compact TypeScript example and a table."),
    {
      id: "fixture-code",
      role: "assistant",
      content: [{ type: "text", text: "Use a pure adapter:\n\n```ts\nconst model = createTurnRenderModel(parts, timing);\nreturn model.answerParts;\n```\n\n| State | Visible |\n| --- | --- |\n| Work | Collapsible |\n| Answer | Always |\n\nInline `code` stays compact and overflow remains local." }],
      status: { type: "complete", reason: "stop" },
      createdAt: new Date(startedAtMs),
    } as ThreadMessageLike,
  ],
};

export function ChatFixture({ name }: { name: string }) {
  const messages = fixtures[name] ?? fixtures.completed!;
  const runtime = useExternalStoreRuntime({
    messages,
    isRunning: name === "running",
    convertMessage: (message) => message,
    onNew: async () => undefined,
    onCancel: async () => undefined,
  });
  return <AssistantRuntimeProvider runtime={runtime}>
    <div className="app-shell fixture-shell"><main><header className="topbar fixture-topbar"><div className="product-mark"><span>π</span><strong>Pi <em>Tin</em></strong></div><div className="session-heading"><strong>Chat fidelity fixture</strong><span>{name}</span></div><div /></header><section className="workspace"><Thread fixtureConnected /></section></main></div>
  </AssistantRuntimeProvider>;
}
