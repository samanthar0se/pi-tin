# Codex and Pi Tin Behavior Comparison

## Benchmark

Compared on 2026-07-14 in the installed Codex Windows app and the current Pi Tin native Tauri development app at the same desktop size.

Both agents received this exact read-only prompt in a fresh `C:\git\pi-remote` task/session:

> Inspect this repository and identify the three highest-risk reliability issues. Do not modify files. Cite the relevant file paths and end with a concise prioritized recommendation.

Codex completed in `1m 52s`. Pi completed in `1m 42s`. Neither modified repository files.

## Matched Behavior

- Both immediately acknowledged the task, kept the run read-only, showed a `Working for …` disclosure, emitted progress before tool activity, collapsed completed work behind `Worked for …`, and left the final answer visible.
- Both produced a concise ordered risk assessment with file references and a prioritized recommendation.
- Both independently identified unbounded Pi RPC operations as the top reliability risk and non-atomic host-session persistence as another top-three risk.
- Both exposed compact activity rows and kept detailed command output behind disclosure rather than placing raw tool payloads in the main answer.
- Both retained a round stop action in the composer while work was active.

## Behavioral Differences

| Area | Codex | Pi Tin before this change | Direction |
| --- | --- | --- | --- |
| Completion time | `1m 52s` | `1m 42s` | No change; model/tool choices naturally vary. |
| Third risk | Half-open WebSockets are not detected | Reconnect can replay a stale snapshot over newer events | Both are valid; no prompt-level alignment should force identical findings. |
| File references | Local path mentions are interactive | Remote paths render as inline code | Keep Pi behavior; pretending a remote path opens locally would be misleading. |
| Answer actions | Copy, rating, and continuation controls | Copy only | Keep only functional Pi actions; do not add fake ratings or branching. |
| New task/session | New task appears immediately | Desktop waits for full RPC startup and can show `create_session timed out` after 30 seconds | Return the session ID immediately and show the tab in `starting` state. |
| Startup failure | Task remains visible and recoverable | Failed Pi runtime could disappear; retry was hidden in Settings and disabled in error state | Retain the errored session and expose `Retry Pi`. |
| Compact header | Actions become clean icon buttons | Text labels clip beside icons around the benchmark width | Hide wrapped labels at compact widths while preserving titles. |
| Built-in slash commands | Task controls remain discoverable in the composer | RPC discovery omits Pi built-ins, so `/compact` was absent even though the header action existed | Register local `/new` and `/compact` entries and route them to real host commands. |
| Batched tools | Consecutive shell work may appear as `Ran commands` | Each Pi tool call originally rendered as a separate top-level row | Group consecutive shell calls behind one expandable `Ran commands` row while preserving every ordered command and result inside. |
| Streaming transcript | Earlier turns remain stable while the latest answer streams | assistant-ui's incremental branch repository could temporarily select a partial branch | Rebuild one exact linear repository from Pi's authoritative message array on every update. |
| Streaming work boundary | Progress stays in the work transcript until the final answer actually begins | Unclassified streamed text after reasoning/tool activity was provisionally treated as the final answer, collapsing earlier work until the next reasoning part arrived | Keep unclassified running text in work and use Pi's finalized `commentary` / `final_answer` phase markers when available. |

## Changes From This Comparison

- Session creation now returns as soon as the host records the runtime; RPC startup continues in the background and reports `starting`, `ready`, or `error` through existing host state.
- A failed startup remains in the session list so it can be retried instead of disappearing after the request fails.
- Pi Tin exposes `Retry Pi` in the main header for an errored selected runtime and enables retry from Connection Settings.
- Restart requests use a two-minute desktop deadline to accommodate slow Windows process startup.
- Compact topbar actions use explicit label spans, producing clean icon-only controls instead of clipped text.
- The composer now discovers and executes `/compact`, including optional custom compaction instructions, and shows a dedicated live status while Pi summarizes the session.
- Expanded work transcripts clean raw reasoning markdown, use tighter spacing, and consolidate consecutive shell calls without discarding details.
- Streaming updates now replace assistant-ui's internal repository with the complete authoritative Pi transcript, preventing temporary branch loss.
- Running turns keep a monotonic work boundary, so new progress or reasoning cannot temporarily hide earlier work transcript items.

## Remaining Reliability Findings

The benchmark found issues beyond visual/interaction fidelity. They should be handled as focused follow-up work:

1. Bound every RPC operation used by health checks, snapshots, restart, and authentication.
2. Order initial snapshot handoff so live events cannot be overwritten by an older snapshot.
3. Add WebSocket liveness detection for half-open LAN connections.
4. Persist host session state atomically and retain a last-known-good backup.
