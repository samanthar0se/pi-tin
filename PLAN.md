# Pi Tin Windows Client — MVP Plan

> The original attach-only transport evolved into a foreground Pi RPC host controller. The product remains intentionally limited to one configured host and one persistent session.

## Context

Build a small personal Windows desktop client for controlling Pi coding-agent sessions running on machines on the same trusted local network. The app should provide a polished Codex-style chat UI, preserve Pi streaming/tool activity, and surface Plannotator plan/code-review workflows inside the desktop window.

Initial findings:
- This is a greenfield workspace; there is no existing application source to extend.
- The MVP will attach to a Pi process that the user has already started; it will not launch or supervise Pi.
- Tau's core transport is a single in-process Pi extension (`extensions/mirror-server.ts`): it broadcasts raw Pi lifecycle/message/tool events over WebSocket, sends a full `mirror_sync` snapshot on connect/reconnect, and accepts small JSON commands such as `prompt`, `steer`, `follow_up`, `abort`, model/thinking changes, and compaction. Exponential reconnect plus a fresh snapshot makes the client recoverable without a separate daemon.
- Tau includes many non-MVP routes (project launch, historical-session search, file browser, exports, QR/PWA) that are unnecessary for this app. Tau is MIT-licensed, so the implementation should freely copy and adapt its proven server/event/reconnect code where that reduces effort, while omitting unrelated features.
- assistant-ui's `useExternalStoreRuntime` is the best fit: the WebSocket/session snapshot remains the source of truth, `convertMessage` maps Pi entries to message/tool parts, and capability callbacks expose send/cancel without pretending the client owns model execution.
- `@plannotator/pi-extension` (MIT OR Apache-2.0) already contains bundled plan and review HTML plus transient Node HTTP servers. Its shared `plannotator:request` API supports plan-mode, plan-review/status, and code-review, but responses expose review IDs/results rather than the browser URL. In remote mode it binds review servers to `0.0.0.0` on `PLANNOTATOR_PORT` (default `19432`) and does not open a browser.

## Approach

Recommended direction:
- Use Tauri 2 with a Vite React/TypeScript frontend, assistant-ui's shadcn-style copied components, and a small persisted settings store. Tauri provides a Windows installer and WebView2 without the footprint of Electron; keep networking in TypeScript unless WebView restrictions force a thin Rust proxy.
- Install both `@plannotator/pi-extension` and a new, narrowly scoped remote-control Pi extension on each remote host. Start it by copying and trimming Tau's proven snapshot + event-stream + command implementation, then add an explicit versioned protocol, request IDs, token authentication, and the Plannotator bridge.
- Store one host connection (`host`, control port, Plannotator port, token) in Settings. Protect the control handshake and health endpoint with an extension-generated, persistent random token: the WebSocket must receive an `auth` message before the server emits a snapshot or accepts commands; use plain HTTP/WebSocket only on the trusted LAN and document that limitation.
- Keep Pi entries/events in an app store and expose them through assistant-ui `useExternalStoreRuntime`; render text, thinking, tool calls/results, markdown/code, running state, and errors with custom message parts/cards.
- Reuse Plannotator unchanged. Its `plannotator_submit_plan` tool blocks until the transient review server returns approval/feedback, while its shared `code-review` event waits for the code-review decision. The remote extension can detect `plannotator_submit_plan` tool start/end, invoke `plannotator:request` for manual code review, route returned approval/feedback to Pi as a follow-up, and emit explicit `review_started`/`review_finished` messages. Configure a fixed per-process `PLANNOTATOR_PORT`; the desktop derives `http://<selected-host>:<plannotator-port>`, waits until it responds, and loads it in a full-size in-app iframe/panel. Plannotator has no frame-blocking response headers in these servers, and its same-origin APIs remain self-contained.
- Accept and clearly label two personal-MVP security limitations: Tauri Store persists the token as local app data rather than Windows Credential Manager, and Plannotator's transient review port is unauthenticated because the upstream server has no auth hook. Limit both ports with the host firewall to the trusted LAN.
- Keep the MVP LAN-only and manually configured; avoid cloud accounts, auto-discovery, SSH/process supervision, session-history browsing, file management, voice, image attachments, multi-user collaboration, and production-scale hardening.

## Files to modify

Greenfield pnpm workspace; critical paths expected:
- `package.json`, `pnpm-workspace.yaml` — workspace scripts and dependency boundaries
- `apps/desktop/src-tauri/` — Tauri 2 Windows shell, capabilities/CSP, icons, and installer config
- `apps/desktop/src/App.tsx` — host/setup, chat, header controls, and review-panel shell
- `apps/desktop/src/runtime/PiRuntimeProvider.tsx` — assistant-ui external-store adapter
- `apps/desktop/src/remote/` — connection manager, normalized Pi session store, reconnect/snapshot handling
- `apps/desktop/src/components/assistant-ui/` — copied and restyled assistant-ui primitives/tool cards
- `apps/desktop/src/components/review/ReviewPanel.tsx` — embedded Plannotator lifecycle/loading/error UI
- `packages/protocol/src/index.ts` — versioned JSON message types and Zod validation
- `packages/pi-tin/index.ts` — minimal Pi extension server, event forwarding, commands, token checks, and Plannotator bridge
- `README.md` — remote Pi install/config/start and Windows app usage

## Reuse

- Copy and adapt Tau's MIT-licensed snapshot/event/command server and reconnect client (`deflating/tau/extensions/mirror-server.ts`, `public/websocket-client.js`), retaining only the MVP subset.
- Plannotator's published Pi package and shared event API (`backnotprop/plannotator/apps/pi-extension/plannotator-events.ts`), transient plan/review servers (`plannotator-browser.ts`, `server/serverPlan.ts`, `server/serverReview.ts`), and bundled review UIs.
- assistant-ui external-store runtime (`assistant-ui/assistant-ui/apps/docs/content/docs/runtimes/custom/external-store.mdx`) and copied/customizable Thread/Message/Composer primitives.

## Steps

- [x] Confirm attach-only connection/session lifecycle (no remote process supervisor).
- [x] Inspect Tau's concrete server protocol, event mapping, reconnect behavior, and licensing/reuse implications.
- [x] Finalize the reliable Plannotator review-start/review-URL integration seam.
- [x] Select assistant-ui external-store runtime and a minimal supporting UI stack.
- [x] Select Tauri 2 and define process/network/security boundaries (trusted-LAN HTTP/WS plus pre-shared token).
- [x] Scaffold a pnpm workspace with the Tauri/Vite React desktop, shared protocol package, and Pi extension package; add assistant-ui, Tailwind, Zustand, Zod, `ws`, Tauri Store, Lucide, and Sonner only.
- [x] Define protocol v1: `auth`; server `snapshot`, `event`, `response`, `review_started`, `review_finished`, `error`; client request-ID commands for `prompt`, `steer`, `follow_up`, `abort`, `set_model`, `set_thinking`, `compact`, `set_plan_mode`, and `start_code_review`. Validate both boundaries and reject commands before auth.
- [x] Implement the Pi extension: retain the current `ExtensionContext`, forward agent/message/tool/model/compaction events, serialize a canonical snapshot from `sessionManager.getEntries()`, expose the minimal commands, bridge Plannotator's shared event API, and cleanly close sockets/server on shutdown.
- [x] Implement the desktop connection/store layer: one Tauri Store connection, one active WebSocket, connection state, request timeouts, bounded exponential backoff, authoritative snapshot replacement after reconnect, event reduction for streaming text/thinking and tool lifecycle, and clear offline/error states.
- [x] Build the polished shell without a sidebar: connection Settings; session title/cwd/connection header; model, thinking, plan-mode, compact, and Review Changes controls; responsive light/dark theme; toasts and keyboard-friendly focus states.
- [x] Adapt normalized Pi state through assistant-ui `useExternalStoreRuntime`: text composer, send/steer/follow-up behavior, stop, markdown/code/copy actions, auto-scroll, collapsible thinking, generic expandable tool cards with running/error states, and disabled controls when disconnected. Do not implement regeneration/branching because Pi remains authoritative.
- [x] Integrate Plannotator: detect automatic plan submission, trigger manual uncommitted-change review through `plannotator:request`, show readiness/loading errors, open the transient URL in a full-size in-app panel, keep a visible Review tab if the user returns to chat, and close it when the matching review completes.
- [x] Add only focused tests for protocol validation/auth, snapshot+stream event reduction, reconnect replacement, and Plannotator start/finish routing; use mocked Pi APIs rather than broad UI snapshots.
- [x] Document remote setup (`@plannotator/pi-extension`, this extension, matching ports/token, firewall), starting Pi manually, adding a Windows host profile, development commands, and MSI/NSIS packaging.
- [ ] Complete a two-machine LAN smoke test covering connect/send/stream/tool/stop, mid-stream reconnect, model/thinking controls, plan approve/reject/revise, code-review feedback, and packaged Windows startup.

## Verification

Keep verification proportional to a personal LAN MVP:
- Type-check/build the desktop UI and Pi extension.
- Focused unit tests for protocol/event conversion and review-result routing.
- Manual end-to-end test from Windows to one remote Pi host: connect, attach, send, stream, stop, reconnect, review a plan, review a diff, and resume the agent.
- Package/install a Windows build and verify embedded review navigation and LAN reconnect behavior.

Explicitly defer performance/load testing, exhaustive UI snapshots, multi-client races, WAN/TLS security, and cross-platform desktop packaging.
