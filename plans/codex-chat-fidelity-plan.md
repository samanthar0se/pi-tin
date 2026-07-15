# Codex Chat Fidelity Plan

## Context

Bring Pi Tin’s chat stream and composer materially closer to the current Codex Windows app while preserving Pi as the authoritative runtime and keeping the product within its one-host, five-session LAN MVP.

This plan is based on a direct comparison performed on 2026-07-14 against:

- Installed Codex Windows package `OpenAI.Codex_26.707.9564.0_x64` / app build `26.707.71524`.
- Live Codex empty, running, completed, expanded-work, expanded-command, markdown, and composer states at the same desktop size.
- The packaged Codex renderer’s public runtime output and design tokens, used only to confirm measurements and behavior seen in the live app.
- Pi Tin’s current implementation in `apps/desktop/src/components/assistant-ui/Thread.tsx`, `ToolCard.tsx`, `MarkdownText.tsx`, `apps/desktop/src/remote/reducer.ts`, and `apps/desktop/src/styles.css`.

The live comparison included a read-only Codex task against this repository. No files were modified by Codex.

## Executive Conclusion

Pi Tin is directionally similar to Codex, but the remaining mismatch is structural rather than cosmetic. The current implementation treats an assistant response as generic assistant-ui parts wrapped in one custom activity disclosure. Codex renders a task turn as a deliberate hierarchy:

1. User prompt.
2. A turn-level `Working for …` / `Worked for …` disclosure and divider.
3. Interleaved progress prose and compact semantic activity rows.
4. Optional nested command/file/tool detail.
5. A plain final answer.
6. A quiet action row and timestamp.

The highest-value work is therefore to introduce a Codex-like turn render model, then restyle around it. Color and spacing changes alone will not close the gap.

## Fidelity Principles

- Match Codex’s hierarchy, density, rhythm, and state transitions before chasing individual pixels.
- Preserve Pi-specific semantics such as steer/follow-up delivery, model selection, thinking level, context usage, slash commands, extension UI, and remote-session authority.
- Do not add nonfunctional Codex controls such as thumbs ratings, branching, regeneration, fake file opening, or fake project/worktree selectors.
- Prefer quiet disclosure over card chrome. Raw tool payloads should be available on demand, not dominate the stream.
- Keep the existing assistant-ui runtime and authoritative Pi message store; replace only the presentation layer that is preventing fidelity.
- Use focused pure-function tests and a small manual visual-state matrix, not a broad screenshot suite.

## Gap Matrix

| Priority | Area | Codex Reference | Pi Tin Today | Required Direction |
| --- | --- | --- | --- | --- |
| P0 | Turn hierarchy | One turn-level work disclosure contains progress and activity before the final answer | `TaskActivity` and `WorkedDivider` are separate approximations driven by part grouping | Build an explicit turn render model and one parent work disclosure |
| P0 | Activity rows | Borderless, 13px semantic rows such as `Ran a command`, nested in the work transcript | Aggregated tool-count summary plus generic expandable cards | Render each meaningful activity in sequence with a semantic label |
| P0 | Running state | `Working for Ns`, full-opacity progress prose, cadenced shimmer only on the pending fragment, round stop control | Spinner plus bold continuous shimmer; red `Stop` pill plus separate send button | Match timer, shimmer cadence, and single round stop/send affordance |
| P0 | Composer | Low-contrast elevated surface, faint half-pixel ring, broader than text column, balanced controls | Visible border, lighter panel, same width as content, two separate model controls | Rebuild composer shell and footer control layout |
| P1 | Tool detail | Closed rows have no card; expanded command shows a nested command line and then a terminal-style panel | Generic `Input` / `Output` card with strong border and labels | Add semantic activity detail variants, especially shell/read/edit |
| P1 | Theme | Dark main surface is near `gray-900` (`#181818`), with subtle 5–12% foreground mixes | Dark main surface is `#212121`, panels `#2f2f2f`, lines are comparatively strong | Introduce Codex-like neutral tokens and softer separators |
| P1 | Typography | 13px chat, 12px code, roughly 20px chat line height | 14px chat at 1.6 line height, creating a looser stream | Use explicit chat/code type tokens and tighter prose rhythm |
| P1 | Message actions | Quiet four-icon row under completed answer; user prompt has edit/copy affordances | Assistant copy is hover-only; no user action treatment | Match row placement and opacity while exposing only real Pi actions |
| P1 | Markdown/code | Tight list rhythm, compact inline code chips, code blocks with language header and copy action | Generic assistant-ui markdown; code block is one bordered panel | Customize markdown components and code-block chrome |
| P1 | Shell height | Compact task header leaves more vertical room for the thread | 64px topbar plus 39px session tabs before optional banners/review tabs | Reduce and visually consolidate shell chrome without adding a sidebar |
| P2 | Empty state | Branded mark, one strong question, optional starter cards, composer near bottom | Mark, question, explanatory paragraph; no prompt starters | Simplify copy and align vertical geometry; retain Pi branding |
| P2 | Responsive behavior | Container-query driven hiding and truncation within the composer/thread | Global viewport breakpoints and hard nth-child hiding | Introduce component container queries and stable narrow layouts |
| P2 | Scrolling | Reverse-oriented virtualized stream, stable bottom anchoring, compact floating jump control | assistant-ui viewport with smooth scrolling and sticky footer | Tune bottom anchoring and jump control; do not add virtualization unless needed |

## Detailed Findings

### 1. Visual Foundation

Codex uses a darker, flatter chat canvas than Pi Tin. Its dark main surface is based on `gray-900`, visually near `#181818`; the composer and code/tool surfaces are only slightly lighter. Borders are generally foreground mixes around 5–12% and many surfaces use a half-pixel ring rather than a conventional one-pixel border.

Pi Tin’s `#212121` canvas and `#2f2f2f` panels compress the tonal range toward mid-gray. This makes the composer, tool cards, session tabs, and code blocks look heavier even where their geometry is already close.

Recommended tokens:

- `--surface-app`: light `#ffffff`; dark near `#181818`.
- `--surface-raised`: a 4–7% foreground mix over the app surface.
- `--surface-composer`: a 7–9% foreground mix over the app surface.
- `--surface-code`: a 6–8% foreground mix over the app surface.
- `--border-light`: 5% foreground mix.
- `--border-default`: 8% foreground mix.
- `--border-heavy`: 12% foreground mix.
- `--text-primary`, `--text-secondary`, `--text-tertiary`, `--conversation-body`, and `--conversation-summary` as separate roles instead of one `--muted` token.
- `--chat-font-size: 13px`, `--chat-line-height: 20px`, and `--code-font-size: 12px`.

Avoid copying Codex’s exact brand colors. Match neutral contrast and role separation.

### 2. Shell and Viewport Geometry

Codex’s content column has a `48rem` maximum width. Its composer is intentionally allowed to overhang the text column by approximately `24px` per side before responsive insets are applied. Pi Tin also uses `768px`, but the same `.thread-column` owns both message padding and composer width, so the composer feels narrower and more boxed in.

Codex’s task header is about 40px high inside the app content. Pi Tin spends 64px on the topbar and another 39px on session tabs. At the tested window height this removes roughly one extra response paragraph from view.

Recommended structure:

- Keep the no-sidebar product direction.
- Reduce the topbar to approximately 48–52px.
- Reduce session tabs to approximately 32–34px.
- Keep the session title and actions in the topbar, but reduce label/icon density.
- Give the scroll viewport a text rail capped at `48rem`.
- Render the composer in a sibling wrapper whose max width is text width plus roughly 40–48px.
- Use 20px desktop side padding and 16px compact side padding.

### 3. Turn Rhythm

Codex’s stream is denser than Pi Tin despite using similar raw dimensions:

- User bubbles use `max-width: 77%`, `12px` horizontal and `8px` vertical padding, and a 16px radius. Pi Tin is already close here.
- Chat text is 13px rather than 14px.
- The distance between a user prompt and its work disclosure is visually larger than the distance between progress items inside the work transcript.
- Activity/progress items use a 16px default gap and about a 4px grouped gap.
- The final answer begins immediately below the work divider without an extra assistant-message card boundary.
- Completed answer actions sit directly below the answer with small 28px targets.

Pi Tin’s global `.message { margin-bottom: 24px }` treats every message uniformly. The new renderer should express spacing by turn region rather than one message margin.

### 4. Work Disclosure Lifecycle

Codex has one work disclosure per assistant turn:

- While running: `Working for 1s`, then a divider.
- The timer updates once per second.
- The running header has no prominent spinner and no always-visible chevron.
- Completed: `Worked for 13s` with a small right chevron.
- Clicking the completed header expands/collapses all pre-answer progress and activity.
- The final answer remains visible regardless of work disclosure state.

Pi Tin currently:

- Collapses `TaskActivity` independently.
- Inserts a separate noninteractive `WorkedDivider` at the detected answer boundary.
- Summarizes all tools in the activity group into one sentence.
- Uses a spinner and bold full-label shimmer.

These concepts should be merged into a `TurnWorkDisclosure` component. `isWorkAnswerBoundary` should disappear as a rendering concern once the turn model explicitly identifies work content and answer content.

### 5. Progress and Thinking

Codex keeps agent progress prose readable and full-opacity while work is active. In the captured task:

- A preamble appeared as a normal chat paragraph.
- A completed activity row followed.
- Another preamble appeared.
- A `Thinking` row indicated the current pending state.

Its shimmer is cadenced: a one-second stepped sweep over only the pending text fragment, then a pause/restart driven by state. It is not a continuously moving gradient over bold text.

Pi Tin should:

- Render progress text as regular 13px chat text within the work disclosure.
- Render reasoning text with the conversation-body color only when it is internal reasoning rather than user-facing progress.
- Use a `CadencedShimmer` component for `Thinking`, `Reading…`, or the current semantic action.
- Remove `font-weight: 700` from the loading treatment.
- Preserve `prefers-reduced-motion` behavior.

### 6. Semantic Activity Rows

Codex does not collapse a whole work turn into `Read files, searched code, and ran a command`. It preserves a sequence of compact semantic rows. Closed rows are borderless and typically contain:

- A 12–14px activity icon.
- A short label such as `Ran a command`.
- A chevron that is hidden until hover/focus unless the row is open.
- Muted conversation-body color that brightens on hover.

Recommended Pi mappings:

- `read`: `Read {basename}` when a path is available; fallback `Read files`.
- `bash`: derive a safe first-command summary such as `Ran Get-Content …`; fallback `Ran a command`.
- `edit` / `write` / `apply_patch`: `Edited {basename}`, `Created {basename}`, or `Edited files`.
- `search`: `Searched for {query}` or `Searched code`.
- `web_search`: `Searched the web` with query detail when concise.
- `fetch_content`: `Opened {host or document}`.
- unknown: humanize the tool name rather than display its raw identifier.
- errors: use the same row layout with a restrained danger color and `Failed …` wording.

Do not display status words such as `Done` on every completed row. Completion is communicated by tense and placement.

### 7. Nested Tool Detail

The captured Codex shell hierarchy is:

1. `Ran a command` summary row.
2. Indented command row: `Ran Get-Content -Raw …`, truncated to one line.
3. Expanded terminal panel with:
   - `Shell` header.
   - Copy control.
   - `$ command` line.
   - Monospace output.
   - Internal vertical scrolling.
   - A compact maximum height.

Pi Tin’s `ToolCard` uses a generic bordered card with wrench and status icons, uppercase `Input` / `Output` labels, and JSON/preformatted blocks. This is the most visibly non-Codex element in the stream.

Replace the generic presentation with variants:

- `ShellActivityDetail`: terminal-like command/output surface.
- `ReadActivityDetail`: path header plus compact text/markdown output.
- `EditActivityDetail`: file path, optional diff stats parsed from available data, and compact diff/text fallback.
- `SearchActivityDetail`: query and result count/list where derivable.
- `GenericActivityDetail`: simple key/value sections without outer card chrome.

Keep raw `argsText` and `result` available for debugging and unknown tools. No protocol change is required for the first pass because `reducer.ts` already preserves tool name, structured args, string result, partial result, and error state.

### 8. Final Answer and Markdown

Codex assistant answers are unboxed and use a tight markdown rhythm. Captured behaviors include:

- 13px prose around 20px line height.
- Bullets with compact item spacing.
- Inline code on a subtle rounded chip.
- Code blocks with a language label and copy action.
- A low-contrast code surface without a strong outer border.
- Wide content scrolls inside its own region rather than widening the thread.

Update `MarkdownText.tsx` to provide explicit renderers for code blocks, inline code, links, tables, and blockquotes rather than relying entirely on the package stylesheet. Retain syntax highlighting already supplied by assistant-ui.

Pi-specific constraints:

- Remote file paths should not pretend to be locally openable.
- Links can retain normal external navigation behavior.
- Code-copy actions are real and should be included.

### 9. Message Actions and Timestamps

Codex shows completed assistant actions directly beneath the answer. Its full row includes copy, rating, and continuation controls; timestamps are visually tertiary. User messages expose edit/copy behavior.

Pi Tin should not clone controls it cannot honor. Recommended treatment:

- Keep assistant copy in the same 28px action rail and reveal it on message hover or keyboard focus for every completed answer.
- Add user-message copy.
- Do not add edit unless Pi gains an authoritative historical-message edit operation.
- Do not add ratings.
- Do not add branching/continuation because the MVP explicitly avoids branching.
- Add a tertiary timestamp only if `createdAt` is present, hidden until hover/focus on wide layouts and available to assistive technology.

### 10. Composer

Codex’s composer is a layered system:

- A broad, low-contrast raised surface.
- Approximately 24px multiline radius and 22px single-line radius.
- Faint ring, almost no visible shadow in dark mode.
- Text region with a 32px minimum editable height and a `25dvh` maximum.
- Footer controls with 28px targets.
- Plus/attachment at left.
- Permission/mode control at left.
- Combined model/reasoning trigger near the right.
- Dictation and one round send/stop control at right.
- Responsive labels disappear by composer container width, not viewport width.

Pi Tin should preserve its capabilities while matching this arrangement:

- Add a real attachment button in addition to paste, using the existing image attachment adapter.
- Combine model and thinking level into one compact trigger or visually adjacent compound control; avoid two icon-heavy native selects.
- Keep context usage as a tooltip/quiet ring, but place it with the model control rather than between message and send actions.
- In active-run mode, replace the red text `Stop` pill with the same round control position used by Send.
- When guidance text is empty, show Stop as the primary round control.
- When guidance text is nonempty, show Send as primary and expose Stop as a small secondary icon so steering remains possible without losing abort.
- Keep `Steer now` / `Follow up`, but restyle it as a quiet compact mode trigger rather than a filled native select.
- Keep slash completion and image previews, restyled to the same elevated menu/radius system.
- Use container queries near 475px, 440px, and 420px to progressively hide labels while retaining icons and accessible names.

### 11. Empty State

Codex’s empty state uses one branded mark, a large question, optional starter cards, and the composer anchored near the bottom. Pi Tin’s explanatory paragraph makes the state feel more like setup documentation.

Recommended changes:

- Retain the Pi mark rather than copying OpenAI branding.
- Use `What should Pi work on?` as the only primary copy.
- Remove or demote `Your remote session remains authoritative…` from the center; it belongs in help/settings.
- Do not add starter cards unless each invokes a useful prompt.
- Match Codex’s vertical position and composer relationship.
- Keep disconnected/no-session states explicit; those are product states Codex does not share.

### 12. Scroll and Responsive Behavior

Codex uses a reverse-oriented virtualized thread and stable bottom anchoring. Pi Tin does not need virtualization for a five-session personal MVP, but it should match the observable behavior:

- No jump when a work disclosure expands or a tool result streams.
- Composer remains fixed while content can continue behind its fade/underlay.
- Jump-to-bottom button sits immediately above the composer and appears only when meaningfully displaced.
- New streaming content follows only if the user was already near the bottom.
- Manual upward scrolling is respected.
- Narrow layout keeps all critical controls reachable without nth-child assumptions.

Remove global `scroll-behavior: smooth` if it causes streaming interpolation or anchoring lag; animate only explicit jump-to-bottom actions.

## Recommended Architecture

### Turn Render Model

Add a pure adapter between assistant-ui message parts and React rendering:

```text
TurnRenderModel
  work
    startedAtMs
    completedAtMs
    status: running | complete | error
    items[]
      progress
      reasoning
      activity
  answerParts[]
```

Each activity item should include:

```text
ActivityViewModel
  id
  kind
  status
  summary
  detailSummary?
  args
  argsText?
  result?
  isError
```

The adapter should:

- Preserve original order.
- Treat text before the last tool/reasoning item as work progress.
- Treat nonempty text after the final activity as final answer content.
- Keep text-only direct answers out of the work disclosure.
- Handle reasoning-only starts, multiple progress/tool cycles, unfinished tools, errors, and cancelled turns.
- Derive work timing from existing message metadata.
- Never mutate the authoritative store message.

### Component Structure

Recommended presentation components:

- `AssistantTurn`
- `TurnWorkDisclosure`
- `WorkItem`
- `ActivityRow`
- `ActivityDetail`
- `ShellActivityDetail`
- `CadencedShimmer`
- `FinalAnswer`
- `MessageActionRail`
- `ComposerSurface`

These can remain in `Thread.tsx` initially if extraction would add churn, but `turn-model.ts` should be separate and independently tested.

## Files to Modify

- `apps/desktop/src/components/assistant-ui/Thread.tsx`
  - Replace unstable generic part grouping with the explicit turn hierarchy.
  - Add work lifecycle, progress rows, activity rows, timestamps, and action rails.
  - Recompose normal and active composer states.
- `apps/desktop/src/components/assistant-ui/ToolCard.tsx`
  - Replace or retire the generic card in favor of semantic detail variants.
- `apps/desktop/src/components/assistant-ui/MarkdownText.tsx`
  - Add Codex-like code block, inline-code, table, link, and copy rendering.
- `apps/desktop/src/components/assistant-ui/turn-model.ts` (new)
  - Pure part-to-turn and tool-to-activity adapters.
- `apps/desktop/src/components/assistant-ui/turn-model.test.ts` (new)
  - Focused ordering, boundary, timing, status, and summary tests.
- `apps/desktop/src/components/assistant-ui/Thread.test.ts`
  - Retain only component-adjacent behavior tests that are not moved into `turn-model.test.ts`.
- `apps/desktop/src/styles.css`
  - Introduce the neutral token system, shell geometry, turn rhythm, activity rows, tool details, markdown, composer, and container queries.
- `apps/desktop/src/remote/reducer.ts`
  - Only if implementation reveals missing stable IDs or timestamps; current args/results/timing are sufficient for the first pass.
- `apps/desktop/src/remote/reducer.test.ts`
  - Add only focused cases for any metadata added above.

No protocol or host change is expected for the initial fidelity pass.

## Reuse

- Existing assistant-ui external-store runtime and message authority.
- Existing image attachment adapter and pasted-image validation.
- Existing slash-command discovery and keyboard navigation.
- Existing model, thinking, context-usage, steer, follow-up, and abort commands.
- Existing `startedAtMs` / `completedAtMs` metadata.
- Existing tool name, structured args, text result, partial result, and error data.
- Existing reduced-motion support.
- Lucide icons, but use them at Codex-like 12–14px activity sizes.

## Implementation Phases

### Phase 0 — Visual Baseline and State Fixture

- [ ] Record reference screenshots at one fixed Windows size for empty, one-line user prompt, multiline prompt, running/thinking, completed tool, expanded work, expanded command, error, code block, image attachment, disconnected, and narrow composer states.
- [ ] Record matching Pi Tin screenshots before changes.
- [x] Add a development-only deterministic chat fixture or story route that renders normalized local messages without a live host; keep it out of production navigation and avoid a new testing framework.
- [x] Define the initial light/dark tokens and measurement constants in one CSS section.

Exit criteria: every later visual change can be compared against the same state matrix without invoking a remote agent.

### Phase 1 — Turn Model and Work Disclosure

- [x] Add `turn-model.ts` and move work/answer boundary logic out of React components.
- [x] Cover direct answers, progress + tool + answer, repeated progress/tool cycles, running tools, tool errors, cancellation, and transcript restoration.
- [x] Replace `Unstable_PartsGrouped` usage with `AssistantTurn` rendering from the model.
- [x] Implement one `Working for …` / `Worked for …` disclosure and divider per turn.
- [x] Tick running duration once per second and preserve completed transcript duration.
- [x] Keep the final answer mounted when work is collapsed.

Exit criteria: the DOM hierarchy and collapse behavior match Codex even before final styling.

### Phase 2 — Activity Rows and Tool Detail

- [x] Replace aggregate tool counts with ordered semantic activity rows.
- [x] Derive concise labels from tool names and args.
- [x] Add hover/focus chevrons and restrained error states.
- [x] Implement shell detail with command summary, terminal panel, copy, and bounded scrolling.
- [x] Implement read/edit/search/web/generic detail variants.
- [x] Remove default wrench/check/status card chrome.
- [x] Ensure long commands and paths truncate without widening the thread.

Exit criteria: closed work reads like Codex’s activity log; raw payloads remain available through nested disclosure.

### Phase 3 — Typography, Markdown, and Theme

- [x] Switch chat to 13px/20px and code to 12px tokens.
- [x] Darken the app canvas and reduce panel/border contrast.
- [x] Tighten paragraphs, lists, headings, and message-region gaps.
- [x] Add inline code chips and code-block header/copy treatment.
- [x] Align action rows and timestamps.
- [x] Implement cadenced pending-text shimmer and remove bold continuous shimmer.

Exit criteria: text density, contrast, and markdown surfaces match the reference at normal zoom in both themes.

### Phase 4 — Composer Fidelity

- [x] Separate text-column and composer maximum widths.
- [x] Rebuild composer surface/ring/radius/underlay.
- [x] Add attachment button using the current adapter.
- [x] Restyle model/thinking as a compact compound control.
- [x] Restyle steer/follow-up as a quiet mode trigger.
- [x] Replace the red stop pill with round send/stop behavior.
- [x] Reposition context usage and preserve its tooltip.
- [x] Match menu and image-preview surfaces.
- [x] Add composer container queries and accessible icon-only fallbacks.

Exit criteria: idle, multiline, attachment, slash menu, active-empty, active-guidance, disconnected, and narrow composer states remain functional and visually coherent.

### Phase 5 — Shell, Empty State, and Scroll Polish

- [x] Reduce topbar and session-tab height while preserving five-session usability.
- [x] Simplify the welcome state and align it with the composer.
- [x] Tune sticky underlay and jump-to-bottom placement.
- [x] Verify expansion and streaming do not jump the viewport.
- [x] Remove smooth scrolling from passive stream updates if necessary.
- [x] Replace nth-child responsive rules with semantic classes/container queries.

Exit criteria: the chat window shows comparable content density to Codex and remains stable across session switching and reconnects.

### Phase 6 — Validation and Cleanup

- [x] Run focused turn-model, thread, and reducer tests.
- [x] Run the canonical `node ./build-host.mjs` build/install command.
- [ ] Compare every fixture state side by side in light and dark themes.
- [ ] Test at 100%, 125%, and 150% Windows scaling.
- [ ] Test keyboard focus, screen-reader names, reduced motion, and high-contrast fallback.
- [ ] Test long paths, long commands, large tool output, code overflow, ten images, and unavailable context usage.
- [ ] Test reconnect during a running turn and transcript restoration after restart.
- [x] Remove obsolete grouping and card CSS after parity is confirmed.

## Visual Acceptance Matrix

Validate at a fixed 1024×768 content area first, then repeat narrow and scaled checks.

| State | Acceptance Criteria |
| --- | --- |
| Empty connected | One clear Pi prompt, quiet branding, composer near bottom, no explanatory paragraph dominating center |
| User prompt | Right aligned, 77% max width, subtle 5% surface, 16px radius, 12×8px padding |
| Running start | `Working for Ns` and divider appear; pending state uses cadenced shimmer; round Stop occupies send position |
| Running with progress | Progress prose remains readable; current pending fragment alone animates |
| Running with tools | Ordered semantic rows appear between progress messages without cards |
| Completed | Header changes to `Worked for Ns`; final answer stays visible; work defaults collapsed |
| Expanded work | Progress and activity restore in original order with compact grouped gaps |
| Expanded command | Summary row → command row → terminal panel hierarchy; bounded internal scrolling; copy works |
| Tool error | Same geometry as success with restrained danger semantics and readable raw error |
| Markdown | Lists, inline code, code block header/copy, tables, and overflow match target density |
| Actions | Real controls use quiet 28px targets; no fake rating/branch affordances |
| Idle composer | Low-contrast surface, faint ring, text-column overhang, balanced left/right controls |
| Active composer | Guidance remains possible; Stop is immediately reachable; no red pill or double-primary controls |
| Attachments | Add/paste/remove/send remain functional; previews do not distort composer radius |
| Slash menu | Menu aligns to composer, keyboard selection remains visible, long descriptions truncate |
| Disconnected | Input and actions disable clearly without changing composer geometry |
| Narrow | Critical controls remain; labels collapse by container width; no clipped send/stop control |
| Reduced motion | No shimmer/spin dependence; state remains understandable |

## Quantitative Targets

Use these as initial targets, then adjust by screenshot comparison:

- Thread text max width: `48rem` / `768px`.
- Composer max width: thread width plus approximately `40–48px`.
- Desktop thread side padding: approximately `20px`.
- Chat font: `13px`; line height: approximately `20px`.
- Code font: `12px`.
- Default work-item gap: `16px`.
- Grouped activity/detail gap: `4px`.
- User bubble: `77%`, `12px 8px`, `16px` radius.
- Composer radius: approximately `24px` multiline and `22px` compact.
- Composer/activity targets: `28px`.
- Activity icons: `12–14px`.
- Tool detail maximum visible height: approximately `280–320px` with internal scroll.
- Topbar: approximately `48–52px`.
- Session tabs: approximately `32–34px`.

## Risks and Mitigations

- **assistant-ui grouping limitations:** `Unstable_PartsGrouped` cannot express Codex’s nested turn/work/activity hierarchy reliably. Mitigate by rendering converted parts through a pure adapter while retaining assistant-ui runtime primitives for thread/composer state.
- **Text classification ambiguity:** Pi emits both user-facing progress and reasoning as text/reasoning parts. Start with order-based rules, preserve raw content, and add focused transcript fixtures for real Pi sequences.
- **Tool diversity:** Extension tools have unknown schemas. Always keep a generic detail fallback and avoid brittle exhaustive parsing.
- **Active composer semantics:** Codex does not expose Pi’s steer/follow-up distinction. Preserve the behavior but reduce its visual weight rather than removing it.
- **Scroll regressions:** Disclosure animation and streaming can fight assistant-ui anchoring. Validate each phase with long output and manual upward scrolling.
- **Overfitting one Codex build:** Centralize measurements and tokens so later Codex changes can be adopted without rewriting components.

## Explicit Non-Goals

- Adding a Codex-style project/sidebar browser.
- Adding worktrees, Git actions, pull-request controls, sites, plugins, schedules, or cloud tasks.
- Adding fake rating, regeneration, edit-history, or branch controls.
- Changing Pi’s authoritative session model.
- Replacing assistant-ui or Zustand.
- Adding a broad visual regression service or new infrastructure.
- Copying OpenAI branding, proprietary assets, or product-specific text.

## Completion Definition

The fidelity pass is complete when:

- The turn hierarchy, running/completed transition, activity rows, expanded command detail, markdown, and composer match the live Codex reference closely at normal Windows scale.
- Pi-specific controls remain fully functional but no longer dominate the visual hierarchy.
- The fixed visual-state matrix has no major spacing, density, contrast, overflow, or state-transition discrepancies.
- Focused tests pass and `node ./build-host.mjs` succeeds.
- The app remains within the existing one-host, five-session LAN MVP.
