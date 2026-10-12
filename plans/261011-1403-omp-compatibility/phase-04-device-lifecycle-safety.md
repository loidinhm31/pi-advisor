# Phase 04: Device Lifecycle, Privacy & Subagent Safety

## Context Links

- Plan Overview: [`./plan.md`](./plan.md)
- Acceptance Matrix: [`./reports/acceptance-matrix.md`](./reports/acceptance-matrix.md) (Scenarios `D1`–`D6`)
- Fork Rules: [`../../AGENTS.md`](../../AGENTS.md) & [Pi Extension Docs](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)
- Planning Brief: [`./research/planning-brief.md`](./research/planning-brief.md)
- Design Decisions: [`./research/design-decisions.md`](./research/design-decisions.md)
- Prompt & Lifecycle Research: [`./research/prompt-settings-research.md`](./research/prompt-settings-research.md)
- TUI & Packaging Research: [`./research/tui-packaging-research.md`](./research/tui-packaging-research.md)
- Prerequisite Phases: [`./phase-01-host-contracts.md`](./phase-01-host-contracts.md), [`./phase-03-prompt-injection.md`](./phase-03-prompt-injection.md)
- Dependent Phases: [`./phase-05-full-gate-settings.md`](./phase-05-full-gate-settings.md), [`./phase-06-integration-and-installation.md`](./phase-06-integration-and-installation.md)

## Overview

- **Date**: 2026-10-11
- **Priority**: P0 (Critical runtime, budget, privacy, and subagent isolation safety)
- **Implementation Status**: DONE (2026-10-11) / 100%
- **Review Status**: Approved (9.5/10 — 2026-10-11, 586/586 tests passing)
- **Owner**: `lifecycle` (starts after `phase-03-prompt-injection.md` because `src/tools/register-lifecycle.ts` is shared; baseline fork `df0fc3f17bfab7d52e3f64704015e0493dfd9e01` v0.13.0, OMP ref `c9de2b02b997f37cc89639282ed35dec86f139e8` with symbol-based lookup due to working-tree line drift)

## Key Insights

_(Static source findings / `[INFERENCE]` from code analysis; not yet runtime-verified during planning — Phase 04 boundary tests and Phase 06 OMP smoke provide runtime verification.)_

1. **OMP `xd://` Double-Event Dispatch (`[INFERENCE]`)**: Writing to `xd://ask_advisor` or `xd://record_advisor_outcome` emits an outer `write` `tool_call`, an inner `ask_advisor`/`record_advisor_outcome` `tool_call` sharing the **same `toolCallId`** (only when `content` is non-help valid JSON matching schema), an inner `tool_result`, and an outer `write` `tool_result` carrying `details.xdev.tool`.
2. **Three Outer-Envelope Defects (`[INFERENCE]`)**:
   - `src/tools/register-lifecycle.ts:106-110` treats outer `tool_result` (`toolName: "write"`) as a non-Advisor tool, calling `session.advanceFollowUpToolCall()`. Because `src/follow-up.ts:45` (`AdvisorFollowUpCache.advanceToolCall`) deletes entries when `entry.toolCallsSince + 1 >= FOLLOW_UP_MAX_TOOL_CALLS` (`3`), a cached follow-up normally survives 2 subsequent non-Advisor tool results and expires on the 3rd; the unskipped outer `write` envelope burns 1 of those 2 surviving slots immediately.
   - `src/tools/register-lifecycle.ts:138-147` passes outer `tool_call` (`toolName: "write"`) into `handleAutomaticGate`, mutating `#repetition` on `session` (resetting non-Advisor tool streaks or triggering false loop gates after repeated `xd://` calls, and double-counting `write xd://record_advisor_outcome`).
   - `src/scout-groups.ts:98-132` (`pendingInvocationDisclosure`) only sanitizes `part.name === "ask_advisor"`, leaving raw `draft`, `includeTrackedFiles`, and `includeUntracked` inside `part.arguments.content` when `part.name === "write"` targets `xd://ask_advisor`.
3. **Unawaited Tool Registry Mutations (`[INFERENCE]`)**: `pi.setActiveTools()` is asynchronous in OMP (`runToolRegistryMutation` + system-prompt rebuild), while `/advisor` (`src/commands/activation.ts:130`) and `/advisor-off` (`src/commands/settings-commands.ts:106`) do not `await` it.
4. **Settlement Event Mismatch (`[INFERENCE]`)**: Pi 1.x emits `agent_settled`; OMP emits `agent_end` (`{ type: "agent_end", messages, willContinue?: boolean }`) and never emits `agent_settled`, leaving abandoned call reservations un-cleared and `advisorSessionSummary` un-emitted in OMP.
5. **In-Process Subagents & Native Advisor (`[INFERENCE]`)**: OMP subagents (`task`, eval `agent()`, `/tan`) run in-process with `ctx.agent?.kind === "sub"` and `PI_SUBAGENT_CHILD` unset. Without context-aware subagent detection, `alwaysOn` at subagent `session_start` overwrites the child's model/effort with `executorRef`, and child `model_select` can overwrite global `advisor.json`. OMP's built-in native advisor (`ctx.agent?.kind === "sub" && ctx.agent?.id === "advisor"`) also shares the extension runner and must not mutate plugin counters.

## Requirements

### Functional

- Recognize outer `write` calls/results targeting canonical `xd://ask_advisor` or `xd://record_advisor_outcome` via a shared bounded helper, while keeping ordinary filesystem `write` calls and other `xd://` devices (`xd://ast_edit`, `xd://tui`, etc.) untouched.
- Preserve existing direct `record_advisor_outcome` non-Advisor counting semantics (no blanket exclusion of `toolName === "record_advisor_outcome"`): only the outer `write` transport envelope is skipped so one logical `record_advisor_outcome` call/result counts once whether invoked directly or via `xd://record_advisor_outcome`.
- Keep inner `ask_advisor` and `record_advisor_outcome` execution authoritative for model access/whitelist checks, consultation budget reservation/consumption, Jev screening, tracked-file handoff, follow-up capture, outcome ledger writes, and provider calls.
- Ensure help queries (`content: "" | "?" | "help"`), malformed JSON, schema validation errors, and cancellations/aborts **before canonical consultation execution (`session.consumeCall` / provider start)** consume 0 budget slots, leave 0 leaked reservations, and do not advance follow-up expiry or loop-gate repetitions; preserve existing budget consumption once `session.consumeCall` has run and the provider consultation has started (including on subsequent provider error/abort).
- Sanitize pending `write xd://ask_advisor` tool calls in `pendingInvocationDisclosure` so Scout sees only `path`, `gitContext`, and `question` (never `draft`, `includeTrackedFiles`, `includeUntracked`, or unparsed malformed `content`).
- `await runtime.pi.setActiveTools(...)` in `/advisor` activation and `/advisor-off` deactivation.
- Handle Pi `agent_settled` (`!hasOmpAgentIdentity(ctx)`) and OMP `agent_end` (`hasOmpAgentIdentity(ctx) && !isNativeHostAdvisor(ctx)`). On `willContinue: true`, return without reservation cleanup or summary: a reserved call not yet executing may still be queued, not abandoned. On final settlement, release only abandoned reservations, preserve active executions, and emit at most one local summary without resetting committed usage.
- Preserve OMP child agent model and thinking level (`ctx.agent?.kind === "sub"`) and prevent child sessions from persisting model changes to `advisor.json`, while ignoring native OMP advisor (`ctx.agent?.kind === "sub" && ctx.agent?.id === "advisor"`) events.

### Non-Functional

- Read [Pi extension docs](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md) before modifying lifecycle hooks, tool blocking, or messages per fork `AGENTS.md`.
- Maintain Pi 1.x typecheck compatibility (`bun check`) without importing `@oh-my-pi/*` packages; no broad source cleanup or unrequested git commits.
- Keep `src/config.ts`, `src/ui.ts`, `src/tools.ts`, and `src/commands.ts` facades frozen (`test/facade-exports.test.ts`) and preserve module boundaries (`scripts/check-module-boundaries.mjs`).
- Preserve tool-action blocking vs session blocking as distinct controls (never escalate one into the other), reuse existing Advisor call/response renderers, and keep session summaries strictly local and ephemeral (never persisted or sent to Herdr).

## Architecture

| Lifecycle Stage | Event / Boundary | Normalization & Accounting Behavior |
| --- | --- | --- |
| 1. Outer `tool_call` | `write` with canonical `xd://ask_advisor` or `xd://record_advisor_outcome` | `advisorDeviceTarget` matches outer `write` envelope; returns `undefined` before `reserveAdvisorCall` and `handleAutomaticGate` (ordinary `write` calls never skip). |
| 2. Inner `tool_call` | `ask_advisor` or `record_advisor_outcome` (same `toolCallId`, valid non-help JSON only) | `ask_advisor` runs `modelAccessBlock` + `reserveAdvisorCall(toolCallId)`. `record_advisor_outcome` runs existing direct `handleAutomaticGate` once. |
| 3. Inner `execute` (`ask_advisor`) | Pre-provider (`screen`, access, handoff) vs `session.consumeCall` + `requestAdvisor` | Active execution tracked while in flight. Pending Scout `pendingInvocationDisclosure` strips `draft`/`includeTrackedFiles`/`includeUntracked` (malformed JSON becomes `"{}"`). Failure/abort/skip **before** `session.consumeCall` releases reservation (0 budget used); once `session.consumeCall` runs, budget consumption is preserved across provider start/failure/abort. |
| 4. Inner `tool_result` | `ask_advisor` or `record_advisor_outcome` | `ask_advisor` skips `advanceFollowUpToolCall()`. `record_advisor_outcome` runs `advanceFollowUpToolCall()` once (preserving direct non-Advisor semantics). |
| 5. Outer `tool_result` | `write` with `details.xdev.tool` or canonical `xd://` `input.path` | `advisorDeviceTarget` matches outer `write` envelope and skips `advanceFollowUpToolCall()`, preserving the 2-result survival / 3rd-result expiry window (`toolCallsSince + 1 >= 3`). |
| 6. Settlement | Pi `agent_settled` / OMP `agent_end`, guarded by host identity | Continuing `agent_end` returns without cleanup or summary. Final settlement releases abandoned reservations, preserves active executions, and emits local summary once. |

## Related Code Files

| File Path | Action | Responsibility |
| --- | --- | --- |
| `src/content-utils.ts` | Modify | Export shared bounded helper `advisorDeviceTarget(toolName, inputOrArgs?, details?)` matching only canonical `write` targets `xd://ask_advisor` and `xd://record_advisor_outcome` (plus outer `details.xdev.tool`), reused by lifecycle and Scout. |
| `src/tools/register-lifecycle.ts` | Modify | Guard native `isNativeHostAdvisor(ctx)` (`kind === "sub" && id === "advisor"`); skip outer `write` advisor-device envelopes in `tool_call` and `tool_result` while preserving direct/inner `record_advisor_outcome` counting; wire `agent_settled` and `agent_end` (`HostAgentEndEvent`) settlement. |
| `src/tools/register-ask-advisor.ts` | Modify | Track active `execute` IDs (`activeExecutions`) for final settlement cleanup; preserve pre- vs post-`consumeCall` budget semantics. |
| `src/tools/types.ts` | Modify | Include `activeExecutions?: Set<string>` on `ToolRegistrationContext` alongside Phase 01 `HostAgentEndEvent` / `AgentAwareContext`. |
| `src/tools/registration.ts` | Modify | Initialize shared `activeExecutions` set on `ToolRegistrationContext` alongside `reservedCalls`. |
| `src/scout-groups.ts` | Modify | Reuse `advisorDeviceTarget` in `pendingInvocationDisclosure` to sanitize pending `write` calls targeting canonical `xd://ask_advisor` and replace malformed JSON `content` with `"{}"`. |
| `src/child-session.ts` | Modify | Implement Phase 01 `hasOmpAgentIdentity(ctx?)`, `isMarkedSubagent(ctx?)` (`PI_SUBAGENT_CHILD === "1" \|\| ctx?.agent?.kind === "sub"`), and `isNativeHostAdvisor(ctx?)` (`ctx?.agent?.kind === "sub" && ctx?.agent?.id === "advisor"`). |
| `src/commands/activation.ts` | Modify | Pass `ctx` to `isMarkedSubagent(ctx)` for model switch, `saveConfig`, `setThinkingLevel`, and `activeModel`; `await runtime.pi.setActiveTools(...)`. |
| `src/commands/activation-preparation.ts` | Modify | Ignore `runtime.pendingExecutorModelRef` when `isMarkedSubagent(ctx)` is true. |
| `src/commands/lifecycle.ts` | Modify | Pass `ctx` to `isMarkedSubagent(ctx)` in `model_select` so child sessions never set `pendingExecutorModelRef` or call `saveConfig`. |
| `src/commands/settings-commands.ts` | Modify | Make `/advisor-off` handler `async` and `await runtime.pi.setActiveTools(...)`. |
| `src/tools/jev-turn-gate.ts` | Modify | Skip turn-gate counting/execution when `isNativeHostAdvisor(ctx)` is true. |
| `test/consultation.test.ts` | Modify | Add unit tests for outer/inner `xd://ask_advisor` and `xd://record_advisor_outcome` sequences, pre- vs post-`consumeCall` budget accounting, 3rd-result follow-up expiry, loop gate, and `agent_end` (`willContinue: true/false`) + `agent_settled` dedupe. |
| `test/scout-context.test.ts` | Modify | Add boundary tests proving pending `write xd://ask_advisor` strips `draft`/`includeTrackedFiles`/`includeUntracked` and malformed `content` falls back to `"{}"`. |
| `test/activation.test.ts` | Modify | Add tests for awaited `setActiveTools` in `/advisor` and `/advisor-off`, `ctx.agent.kind === "sub"` model/effort preservation, and `ctx.agent.kind === "sub" && ctx.agent.id === "advisor"` isolation. |

## Implementation Steps

1. **Add Shared Canonical `xd://` Target Helper (`src/content-utils.ts`)**:
   - Export `advisorDeviceTarget(toolName: unknown, inputOrArgs?: unknown, details?: unknown): "ask_advisor" | "record_advisor_outcome" | undefined`:
     - Return `undefined` immediately if `toolName !== "write"`.
     - If `isRecord(details) && isRecord(details.xdev)` and `(details.xdev.tool === "ask_advisor" || details.xdev.tool === "record_advisor_outcome")`, return `details.xdev.tool`.
     - If `isRecord(inputOrArgs) && isString(inputOrArgs.path)`, trim `inputOrArgs.path`, check `trimmed.slice(0, 5).toLowerCase() === "xd://"`, and match `trimmed.slice(5)` against exact `"ask_advisor"` or `"record_advisor_outcome"` (no query `?`, hash `#`, slash `/`, or prefix matching).
2. **Extend Context-Aware Subagent & Native Advisor Helpers (`src/child-session.ts`)**:
   - Reuse Phase 01's `hasOmpAgentIdentity(ctx?)` contract: non-null agent object, `kind` equal to `"main"` or `"sub"`, and string `id`; do not introduce a weaker duplicate detector.
   - Update `isMarkedSubagent(ctx?: AgentAwareContext): boolean` to return `process.env.PI_SUBAGENT_CHILD === "1" || ctx?.agent?.kind === "sub"`.
   - Export `isNativeHostAdvisor(ctx?: AgentAwareContext): boolean` returning `ctx?.agent?.kind === "sub" && ctx?.agent?.id === "advisor"`.
   - Update `effectiveExecutorRef(ctx)` and `effectiveExecutorEffort(ctx)` to pass `ctx` to `isMarkedSubagent(ctx)`.
3. **Thread `ctx` & Await `setActiveTools` in Commands (`src/commands/activation.ts`, `src/commands/activation-preparation.ts`, `src/commands/lifecycle.ts`, `src/commands/settings-commands.ts`)**:
   - In `src/commands/activation-preparation.ts:80`, pass `isMarkedSubagent(ctx) ? undefined : runtime.pendingExecutorModelRef` to `planActivationModels`.
   - In `src/commands/activation.ts`: pass `ctx` to `isMarkedSubagent(ctx)` at lines 60, 125, and 136; guard `saveConfig` at line 118 with `!isMarkedSubagent(ctx)`; `await runtime.pi.setActiveTools(...)` at line 130.
   - In `src/commands/lifecycle.ts:52`, pass `ctx` to `isMarkedSubagent(ctx)`.
   - In `src/commands/settings-commands.ts:105`, make `/advisor-off` `async` and `await runtime.pi.setActiveTools(...)`.
4. **Normalize Outer `xd://` Envelopes & Settlement (`src/tools/register-lifecycle.ts`, `src/tools/register-ask-advisor.ts`, `src/tools/jev-turn-gate.ts`)**:
   - Return early in `before_agent_start`, `tool_call`, `tool_result`, and `handleJevTurnEnd` when `isNativeHostAdvisor(ctx)` is `true`.
   - In `tool_call`: when `advisorDeviceTarget(event.toolName, event.input)` is defined (outer `write` to `xd://ask_advisor` or `xd://record_advisor_outcome`), return `undefined` before `reserveAdvisorCall` and `handleAutomaticGate`. Inner `ask_advisor` runs `modelAccessBlock` + `reserveAdvisorCall`; inner or direct `record_advisor_outcome` runs existing `handleAutomaticGate` once.
   - In `tool_result`: skip `session.advanceFollowUpToolCall()` only when `event.toolName === "ask_advisor" || advisorDeviceTarget(event.toolName, event.input, event.details) !== undefined`. Do **not** skip `event.toolName === "record_advisor_outcome"` so direct and inner `record_advisor_outcome` results preserve existing non-Advisor counting once per logical call.
   - Track active in-flight `ask_advisor` `execute` IDs (`activeExecutions.add(_id)` on entry, `activeExecutions.delete(_id)` in `finally`).
   - Guard settlement across Pi `agent_settled` (`!hasOmpAgentIdentity(ctx)`) and OMP `agent_end` (`hasOmpAgentIdentity(ctx) && !isNativeHostAdvisor(ctx)`), with per-settle cycle guard reset on `before_agent_start` / `tool_call`:
     - On `event?.willContinue === true`, return immediately without clearing reservations, emitting a summary, or resetting committed usage, follow-up caches, or consultation counts.
     - At final settlement only, `clearAbandonedReservations()` releases IDs in `reservedCalls` that are not in `activeExecutions`; verify the host has finished queued canonical dispatch before classifying an unstarted reservation as abandoned.
     - On final settlement (`agent_settled` in Pi, or `agent_end` with `!event?.willContinue` in OMP): call `clearAbandonedReservations()` and emit local ephemeral `session.summary(getAdvisorMaxCallsPerSession())` at most once when `!isSimpleMode() && !session.blocked && advisorSessionSummaryRef`.
5. **Sanitize Pending `write xd://ask_advisor` in Scout (`src/scout-groups.ts`)**:
   - In `pendingInvocationDisclosure` (`src/scout-groups.ts:98-132`), when `advisorDeviceTarget(part.name, part.arguments) === "ask_advisor"` and `isRecord(part.arguments)`:
     - Parse `part.arguments.content` with `JSON.parse` in a `try/catch`; if it is a plain record, retain only `gitContext` and `question` inside `content: JSON.stringify(allowed)` alongside `path: part.arguments.path`.
     - If `content` is missing, non-string, malformed JSON, or non-record, set `arguments: { path: part.arguments.path, content: "{}" }` (never raw fallback).
6. **Write Observable Boundary Tests (`test/consultation.test.ts`, `test/scout-context.test.ts`, `test/activation.test.ts`)**:
   - Simulate OMP 4-event `write xd://ask_advisor` and `write xd://record_advisor_outcome` sequences and verify:
     - `followUpTo` remains valid across 2 subsequent non-Advisor tool results (`read`/`bash` or 1 logical `record_advisor_outcome` + 1 `read`) and **expires on the 3rd non-Advisor tool result** (`toolCallsSince + 1 >= 3`).
     - 3 consecutive `write xd://ask_advisor` calls do not trigger `handleAutomaticGate` or reset an in-progress `bash` loop-gate streak; 1 `write xd://record_advisor_outcome` counts as 1 logical non-Advisor call/result (matching direct `record_advisor_outcome`).
     - Help (`content: "?"`), malformed JSON (`content: "{bad"`), and pre-`consumeCall` aborts/skips consume 0 budget slots; once canonical execution reaches `session.consumeCall` (provider start), subsequent provider failure/abort preserves the consumed budget slot.
     - Continuing `agent_end` preserves both active and queued reservations and emits no summary; final settlement releases abandoned reservations, preserves active executions, and emits summary once even if `agent_settled` also fires.
     - `pendingInvocationDisclosure` on canonical `write xd://ask_advisor` strips `draft`, `includeTrackedFiles`, and `includeUntracked`, and replaces malformed `content` with `"{}"`, while final Advisor request still receives `<executor_draft>`.
     - Subagent (`ctx.agent = { id: "Task1", kind: "sub" }`) preserves child `ctx.model`/`ctx.thinkingLevel` without writing `advisor.json`; native advisor (`ctx.agent = { id: "advisor", kind: "sub" }`) events are ignored.
   - **Focused Verification Command (run once by parent after Phase 04 edits; implementer skips gates)**: `bun test test/consultation.test.ts test/scout-context.test.ts test/activation.test.ts`

## Todo List

- [x] Export canonical `advisorDeviceTarget` helper in `src/content-utils.ts`
- [x] Extend `isMarkedSubagent(ctx?)` and export `hasOmpAgentIdentity(ctx?)` + `isNativeHostAdvisor(ctx?)` (`kind === "sub" && id === "advisor"`) in `src/child-session.ts`
- [x] Thread `ctx` to subagent checks and `await runtime.pi.setActiveTools(...)` in `src/commands/`
- [x] Normalize outer `write` `xd://` envelopes, preserve direct/inner `record_advisor_outcome` counting, and reconcile `willContinue` / final settlement in `src/tools/`
- [x] Guard `handleJevTurnEnd` with `isNativeHostAdvisor(ctx)` in `src/tools/jev-turn-gate.ts`
- [x] Sanitize pending `write xd://ask_advisor` via `advisorDeviceTarget` in `src/scout-groups.ts`
- [x] Add unit tests in `test/consultation.test.ts`, `test/scout-context.test.ts`, and `test/activation.test.ts`

## Success Criteria

- Scenarios `D1`–`D6` in [`./reports/acceptance-matrix.md`](./reports/acceptance-matrix.md) pass via `bun test test/consultation.test.ts test/scout-context.test.ts test/activation.test.ts`.
- Outer `write` to canonical `xd://ask_advisor` or `xd://record_advisor_outcome` never double-counts loop-gate repetition or follow-up expiry; direct and inner `record_advisor_outcome` preserve existing 1-call non-Advisor counting; `followUpTo` survives 2 non-Advisor results and expires on the 3rd; pre-execution help/invalid JSON/abort consumes 0 budget while post-`consumeCall` provider start/failure preserves existing consumption (`D1`–`D3`).
- Pending Scout manifest for `write xd://ask_advisor` contains only `path`, `gitContext`, and `question` (or `content: "{}"` when malformed), while final Advisor request retains explicit `<executor_draft>` (`D4`).
- Settlement (`D5`) preserves active and queued reservations on `willContinue: true` without summary or committed-state reset; final settlement releases only abandoned reservations and emits at most one local ephemeral summary.
- OMP subagents (`ctx.agent.kind === "sub"`) keep their assigned model/effort and never overwrite global `advisor.json`, and native `ctx.agent.kind === "sub" && ctx.agent.id === "advisor"` events are ignored (`D6`).

## Risk Assessment

- **Risk**: Over-matching `write` calls could skip loop gating for legitimate file writes.
  - **Mitigation**: Match only canonical `xd://ask_advisor` and `xd://record_advisor_outcome` (plus outer `details.xdev.tool` on `write`) via shared `advisorDeviceTarget` helper; never use prefix or query/hash wildcard matching.
- **Risk**: Host emitting both `agent_end` and `agent_settled` could notify twice, or `willContinue: true` could drop an in-flight reservation.
  - **Mitigation**: Guard settlement by host identity; continuing events do not clean up. At final settlement, distinguish active executions from abandoned reservations and guard summary emission per settled cycle.

## Security Considerations

- **Fail-Closed Pending Scout Sanitization**: Malformed JSON in `write xd://ask_advisor` `content` must never fall back to raw string disclosure in Scout's `<conversation>` group.
- **Global Config Integrity**: Subagent `model_select` and `session_start` handlers must never write child-selected models to the user's global `~/.omp/agent/advisor.json`.

## Next Steps

- Proceed to [`./phase-05-full-gate-settings.md`](./phase-05-full-gate-settings.md) to align settings descriptions, behavioral UI roundtrips, and opt-in JSON merge documentation.

## Unresolved Questions

- None. Startup tool availability remains unchanged per `design-decisions.md`.
