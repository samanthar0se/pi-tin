# Full Remote Session Sidebar and Switching Plan

## Context

Replace the desktop sidebar's host-profile list with a real list of Pi sessions. A user selects one configured host elsewhere in the UI, then sees that host's sessions grouped and sorted like the Codex app. Clicking a session makes it the active, writable Pi session; creating a session starts a fresh conversation in a selected project.

This is not only a sidebar rename. The current transport is an extension inside an already-running TUI process, and extension event handlers receive `ExtensionContext`, which intentionally cannot switch sessions. Tau therefore makes session switching a no-op in mirror mode. Pi's RPC mode does support `switch_session` and `new_session`, so full switching requires moving process/session ownership into a small host controller.

The recommended small-scale design keeps one active Pi runtime per host, not many simultaneous agents. Past sessions are listed from disk and become live when selected. The operational change is that remote-only use starts the Pi Remote host controller instead of manually starting a TUI process. A separately started TUI remains independent and is not controlled by this app.

## Approach

### Host controller

Add a foreground Node host process that:

- owns the authenticated HTTP/WebSocket endpoint currently hosted by the extension;
- starts one child Pi process in `--mode rpc` using Pi's public `RpcClient`;
- imports `SessionManager.listAll()` to build the session catalog across projects;
- translates the existing desktop protocol to Pi RPC commands/events;
- uses RPC `switch_session`, `new_session`, prompting, abort, model, thinking, and compaction commands;
- restarts the RPC child after a crash and restores the last active session when possible;
- watches the shared random-token file and disconnects clients when `/pi-remote` rotates it.

Keep this as a foreground command for the personal MVP (`node ./start-host.mjs`). Do not add a Windows service, systemd unit, SSH launcher, or multi-process supervisor yet.

### Session catalog and switching

Expose opaque catalog IDs rather than accepting arbitrary file paths from the desktop. The host resolves IDs only against its latest `SessionManager.listAll()` result.

A session item contains:

- catalog/session ID and active flag;
- display name, falling back to the first user message;
- project/cwd;
- created/modified timestamps;
- message count;
- running/review status for the active session only.

Switch flow:

1. Desktop sends `switch_session { sessionId }`.
2. Host rejects the request while the agent is running or a Plannotator decision is open; the UI offers Stop first rather than silently aborting work.
3. Host resolves the ID to a catalog path and calls Pi RPC `switch_session`.
4. After Pi reloads extensions/resources, the host requests current state/entries and emits one authoritative snapshot.
5. Host emits a refreshed session catalog and persists the selected session path for host-controller restart recovery.

New-session flow:

- **New in current project** uses RPC `new_session`.
- **New in another project** restarts the single RPC child with that cwd, then starts a fresh session.
- Session deletion, forking, cloning, rename-in-sidebar, and simultaneous running sessions are deferred unless they prove necessary after the basic switching UX is stable.

### Desktop information architecture

Move connection management out of the sidebar:

- top-left host selector shows the selected machine and connection state;
- a Settings dialog manages host/IP, ports, and generated token;
- the sidebar header becomes **Sessions** with a New Session button;
- rows show session title, project name, relative time, active/running indicator, and selected state;
- group rows by **Today**, **Previous 7 Days**, and **Older**; add simple local filtering only if the list becomes cumbersome;
- clicking a row shows a loading state until the replacement snapshot arrives;
- disconnected mode keeps the last catalog visible but disables switching and composing.

The chat store remains single-threaded: on switch, discard the prior normalized message state and replace it from the new authoritative snapshot. Do not try to keep assistant-ui runtimes alive for every historical session.

### Plannotator and token settings

Run `@plannotator/pi-extension` inside the RPC child. Preserve fixed review-port behavior and the existing desktop Review tab.

- Automatic plan reviews continue to be detected from `plannotator_submit_plan` tool events.
- Manual code review is invoked as the Plannotator extension command through RPC `prompt`.
- Block session switching while a review is unresolved so feedback cannot land in the wrong session.
- Forward relevant RPC `extension_ui_request` notifications/errors to the desktop.

The host controller and `/pi-remote` command share `~/.pi/agent/pi-remote.json`. The controller prints the initial token at startup because a headless RPC process cannot solve initial authentication through a remote settings dialog. Token rotation updates the file, disconnects authenticated sockets, and requires the desktop profile to be updated.

## Protocol Changes

Introduce protocol v2 with the existing auth/snapshot/event messages plus:

- client `list_sessions`;
- client `switch_session { sessionId }`;
- client `new_session { cwd? }`;
- server `session_catalog { sessions, activeSessionId }`;
- server `session_switching { sessionId }`;
- server `host_state { rpcStatus, activeReviewId? }`.

Keep request IDs, Zod validation, auth-before-data, bounded reconnect, and snapshot replacement. A v1 desktop should receive a clear incompatible-version error rather than malformed events.

## Files to Modify

- `packages/host/package.json` — host-controller package and runtime dependencies
- `packages/host/src/controller.ts` — Pi RPC child lifecycle and command routing
- `packages/host/src/session-catalog.ts` — `SessionManager.listAll()` mapping and opaque ID resolution
- `packages/host/src/websocket-server.ts` — authenticated protocol v2 endpoint
- `packages/host/src/plannotator.ts` — review lifecycle and RPC extension-UI forwarding
- `packages/protocol/src/index.ts` — protocol v2 session commands/events/schemas
- `packages/pi-remote/index.ts` — retain token settings; remove the duplicate WebSocket/mirroring server once the controller owns transport
- `apps/desktop/src/components/SessionSidebar.tsx` — session rows/groups/new-session action
- `apps/desktop/src/components/HostSettingsDialog.tsx` — moved host-profile CRUD
- `apps/desktop/src/remote/store.ts` — host selection, session catalog, switch state, and authoritative reset
- `apps/desktop/src/remote/connection.ts` — protocol v2 negotiation and commands
- `apps/desktop/src/App.tsx` — host selector and session-oriented shell
- `build-host.mjs` — build/install the settings extension and host controller
- `start-host.mjs` — foreground host-controller entry point
- `README.md` — new host startup, migration, and recovery workflow

## Reuse

- Pi `RpcClient` for typed process commands/events and `switchSession()`/`newSession()`.
- Pi `SessionManager.listAll()` and `SessionInfo` instead of Tau's custom JSONL directory parser.
- Current token store, protocol validation, WebSocket authentication, reconnect, snapshot normalization, assistant-ui runtime, and Plannotator Review panel.
- Tau's sidebar grouping/title fallback ideas only where Pi's `SessionInfo` does not already provide the data.

## Steps

- [ ] Add protocol v2 session/catalog schemas and compatibility failure handling.
- [ ] Build the host controller around one Pi RPC child and forward existing chat/tool/model events.
- [ ] Build the validated `SessionManager.listAll()` catalog and refresh it on startup, switch, new session, rename, and session completion.
- [ ] Implement guarded `switch_session` and `new_session`, authoritative post-switch snapshots, crash recovery, and last-session persistence.
- [ ] Move Plannotator review detection/invocation to the RPC relay and block unsafe switching during active reviews.
- [ ] Reduce the Pi extension to token settings/shared token rotation responsibilities and make the host watch token changes.
- [ ] Replace `InstanceSidebar` with `SessionSidebar`; move profile CRUD into Host Settings and add the top-level host selector.
- [ ] Update `build-host.mjs`, add `start-host.mjs`, and document migration from manually started TUI mirroring.
- [ ] Add focused protocol, catalog/path-validation, RPC-switch, crash-recovery, store-reset, and review-switch-guard tests.
- [ ] Complete a two-machine smoke test with sessions from multiple projects, switching in both directions, a new session, reconnect during switching, and plan/code review before and after switches.

## Verification

Keep validation focused on the dangerous boundaries:

- Unit-test that arbitrary/unlisted session paths cannot be switched to.
- Integration-test the host controller with a temporary Pi RPC session directory: list, switch, new, send, stream, abort, and restart recovery.
- Verify the desktop never shows messages from the previous session after a switch snapshot.
- Verify switching is blocked while running and while a Plannotator decision is pending.
- Manually run the foreground controller on one host, connect the portable Windows client, and switch among sessions from at least two project directories.
- Verify `/pi-remote` token rotation disconnects the desktop and the new token reconnects without restarting the controller.
