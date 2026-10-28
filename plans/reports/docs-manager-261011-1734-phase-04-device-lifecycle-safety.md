# Phase 04 Documentation Update Report: Device Lifecycle, Privacy & Subagent Safety

- **Plan**: `plans/261011-1403-omp-compatibility/plan.md`
- **Phase**: `plans/261011-1403-omp-compatibility/phase-04-device-lifecycle-safety.md`
- **Date**: 2026-10-11
- **Agent**: Phase04DocsManager

## Deliverables Summary

Phase 04 addresses runtime, accounting, privacy, and subagent isolation safety across Pi 1.x and Oh-My-Pi (OMP) environments:

1. **Shared Canonical Target Helper (`src/content-utils.ts`)**:
   - Implemented `advisorDeviceTarget(toolName, inputOrArgs?, details?)` to recognize outer `write` tool calls and results targeting canonical `xd://ask_advisor` and `xd://record_advisor_outcome` (or carrying `details.xdev.tool`).
   - Ordinary filesystem `write` calls and unrelated `xd://` devices (`xd://ast_edit`, `xd://tui`, etc.) remain completely untouched.

2. **Lifecycle Hook Normalization & Settlement (`src/tools/register-lifecycle.ts`, `src/tools/register-ask-advisor.ts`, `src/tools/jev-turn-gate.ts`, `src/tools/registration.ts`, `src/tools/types.ts`)**:
   - Outer `write` device envelopes bypass automatic loop-gate evaluation (`handleAutomaticGate`) and follow-up cache decrement (`advanceFollowUpToolCall()`), preserving the 2-result survival / 3rd-result expiry window (`toolCallsSince + 1 >= 3`).
   - Inner and direct `record_advisor_outcome` calls preserve accurate 1-call non-Advisor counting for loop gates and follow-up expiration.
   - Pre-execution validation (help queries `""`, `"?"`, `"help"`, malformed JSON, schema failures, or pre-`consumeCall` aborts) consumes 0 budget slots and leaves 0 leaked reservations.
   - Once canonical execution starts provider consultation (`session.consumeCall`), budget consumption is preserved across subsequent errors or aborts.
   - Dual-host settlement reconciles Pi 1.x `agent_settled` (when no OMP agent identity is present) and OMP `agent_end` events. Intermediate turns with `willContinue: true` preserve active and queued call reservations without clearing state or emitting summaries. Final settlement releases abandoned reservations while preserving in-flight executions, emitting at most one ephemeral summary per settled cycle.

3. **Subagent & Native Host Isolation (`src/child-session.ts`, `src/commands/activation.ts`, `src/commands/activation-preparation.ts`, `src/commands/lifecycle.ts`, `src/commands/settings-commands.ts`)**:
   - Enhanced `isMarkedSubagent(ctx)` to detect in-process subagents (`ctx.agent?.kind === "sub"`), ensuring child sessions preserve their host-assigned model and reasoning level without being overwritten by `alwaysOn` `executorRef`.
   - Prevented child sessions from mutating or persisting changes to global `advisor.json` or updating `pendingExecutorModelRef`.
   - Added `isNativeHostAdvisor(ctx)` (`ctx.agent?.kind === "sub" && ctx.agent?.id === "advisor"`), isolating host native advisor turns from plugin lifecycle hooks (`before_agent_start`, `tool_call`, `tool_result`, `handleJevTurnEnd`) so native advisor turns never pollute turn counters or trigger turn gates.
   - Awaited asynchronous host tool registry mutations (`pi.setActiveTools`) in `/advisor` and `/advisor-off` commands.

4. **Scout Privacy Sanitization (`src/scout-groups.ts`)**:
   - Sanitized pending `write xd://ask_advisor` tool calls in `pendingInvocationDisclosure` so Scout manifests receive only `path`, `gitContext`, and `question`.
   - Sensitive arguments (`draft`, `includeTrackedFiles`, `includeUntracked`) are stripped, and malformed JSON payloads fail closed to `"{}"`.
   - Explicit `<executor_draft>` and consented files continue to be disclosed directly to the final Advisor model request.

---

## OMP Compatibility Guarantees

| Area                    | Pi 1.x Behavior                                                                  | OMP Compatible Behavior                                                                                                                                                |
| ----------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tool Invocations**    | Direct `ask_advisor` and `record_advisor_outcome` tool calls                     | Dual-event dispatch normalized: outer `write` envelope bypassed in loop gate and follow-up decrement; inner canonical tool remains authoritative                       |
| **Follow-Up Cache**     | Survives 2 non-Advisor tool results, expires on 3rd                              | Outer `write` envelope does not advance `toolCallsSince`; 2-result survival / 3rd-result expiry window preserved                                                       |
| **Loop Gates**          | Evaluates repetitive tool calls by signature                                     | Outer `write xd://` does not reset streaks or trigger false loop gates; inner/direct `record_advisor_outcome` counts as 1 logical tool call                            |
| **Consultation Budget** | Pre-execution help/schema aborts consume 0 budget; provider start commits 1 slot | Identical: pre-execution help/malformed JSON/abort uses 0 budget slots; post-`consumeCall` provider start preserves consumption                                        |
| **Settlement**          | `agent_settled` triggers reservation cleanup and local summary                   | `agent_end` with `willContinue: true` retains reservations; final settlement (`!willContinue` or `agent_settled`) cleans abandoned reservations and emits summary once |
| **Tool Registry**       | Synchronous or asynchronous `setActiveTools`                                     | `await pi.setActiveTools(...)` in `/advisor` and `/advisor-off` ensures prompt rebuild and registry synchronization                                                    |

---

## Subagent Isolation Guarantees

- **Model & Effort Integrity**: Child sessions (`ctx.agent?.kind === "sub"` or `PI_SUBAGENT_CHILD=1`) retain their assigned model and thinking level; persistent activation (`alwaysOn`) at `session_start` does not overwrite the child configuration with the parent's `executorRef`.
- **Global Config Protection**: Subagents cannot write or persist changes to `advisor.json` or modify `pendingExecutorModelRef`.
- **Native Host Advisor Isolation**: Host-native advisor subagents (`ctx.agent?.kind === "sub" && ctx.agent?.id === "advisor"`) are completely ignored by extension lifecycle hooks, preventing host-internal advisor reasoning from polluting plugin counters, turn gates, or loop-gate repetition.
- **Summary Ephemerality**: Session summaries remain strictly local and in-memory, never persisted to disk or leaked across subagent boundaries.

---

## Documentation Changes

1. **`docs/configuration.md`** (Updated, 196 LOC):
   - Documented in-process OMP subagent model and thinking level preservation (`ctx.agent.kind === "sub"`), global `advisor.json` protection, and native host advisor isolation under `## Simple mode and persistent activation`.
   - Documented asynchronous `await pi.setActiveTools(...)` in `/advisor` and `/advisor-off`.
   - Added dedicated `## Device lifecycle and event dispatch` section documenting outer `write` envelope normalization (`advisorDeviceTarget`), loop-gate streak protection, follow-up cache lifetime preservation, inner execution authority, budget reservation semantics, dual-host settlement reconciliation (`agent_settled` vs `agent_end`), and subagent isolation.

2. **`docs/privacy.md`** (Updated, 113 LOC):
   - Documented fail-closed pending invocation disclosure in `## Experimental Advisor Scout`: scrubbing of `draft`, `includeTrackedFiles`, and `includeUntracked` from pending `write xd://ask_advisor` calls, with malformed JSON fallback to `"{}"`.
   - Added dedicated `## Subagent and multi-agent safety` section covering global configuration protection, child model preservation, native host advisor isolation, and session summary ephemerality.

3. **`docs/project-roadmap.md`** (Updated, 103 LOC):
   - Marked Phase 04 as DONE (2026-10-11) / 100%.
   - Documented Phase 04 deliverables across canonical target helper, lifecycle hook normalization, settlement reconciliation, subagent/native host isolation, and Scout privacy sanitization.
   - Harmonized wording with documentation validator.

---

## Validation

- **File Size Checks**:
  - `docs/configuration.md`: 196 lines (< 800 LOC limit)
  - `docs/privacy.md`: 113 lines (< 800 LOC limit)
  - `docs/project-roadmap.md`: 103 lines (< 800 LOC limit)
- **Link & Code Reference Validation**:
  - Ran `node ~/.omp/agent/evcrate/scripts/validate-docs.cjs docs/`.
  - 0 code reference issues in updated docs (`docs/configuration.md`, `docs/privacy.md`, `docs/project-roadmap.md`).
  - 17/17 internal markdown links verified OK.
- **Accuracy Verification**:
  - All documented symbols (`advisorDeviceTarget`, `isMarkedSubagent`, `isNativeHostAdvisor`, `hasOmpAgentIdentity`, `advanceFollowUpToolCall`, `handleAutomaticGate`, `pendingInvocationDisclosure`) cross-referenced against `src/`.

---

## Unresolved Questions

None.
