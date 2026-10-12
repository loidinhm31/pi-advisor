# Code Review Summary: Phase 04 Device Lifecycle, Privacy & Subagent Safety

- **Plan**: `plans/261011-1403-omp-compatibility/plan.md`
- **Phase**: `plans/261011-1403-omp-compatibility/phase-04-device-lifecycle-safety.md`
- **Date**: 2026-10-11
- **Reviewer**: Phase04Reviewer
- **Score**: 9.5/10

---

### Scope

- **Files reviewed**:
  - `src/content-utils.ts`
  - `src/child-session.ts`
  - `src/commands/activation.ts`
  - `src/commands/activation-preparation.ts`
  - `src/commands/lifecycle.ts`
  - `src/commands/settings-commands.ts`
  - `src/tools/types.ts`
  - `src/tools/registration.ts`
  - `src/tools/register-lifecycle.ts`
  - `src/tools/register-ask-advisor.ts`
  - `src/tools/jev-turn-gate.ts`
  - `src/scout-groups.ts`
  - `test/consultation.test.ts`
  - `test/scout-context.test.ts`
  - `test/activation.test.ts`
  - `test/helpers/extension-context.ts`
  - `test/helpers/harness.ts`
- **Lines analyzed**: ~1,250 lines (393 added / 247 removed in src; 406 added in tests)
- **Review focus**: Phase 04 Device Lifecycle, Privacy & Subagent Safety (OMP `xd://` double dispatch, follow-up expiry, loop gate streaks, pending Scout sanitization, settlement reconciliation across Pi/OMP, in-process subagent model isolation)
- **Updated plans**:
  - `plans/261011-1403-omp-compatibility/phase-04-device-lifecycle-safety.md`
  - `plans/261011-1403-omp-compatibility/plan.md`

---

### Overall Assessment

High-quality, robust implementation meeting all acceptance criteria for Phase 04 (scenarios D1–D6). Design strictly adheres to YAGNI/KISS/DRY:

- `advisorDeviceTarget` centralized in `src/content-utils.ts`, avoiding duplicate parsing across lifecycle and Scout modules.
- Outer `write` envelopes targeting `xd://ask_advisor` and `xd://record_advisor_outcome` correctly excluded from premature follow-up cache expiration and loop-gate counting while maintaining exact single-counting semantics for logical calls.
- Scout pending-invocation sanitization handles malformed JSON safely with fail-closed `{ content: "{}" }` fallback, preventing leaks of drafts or tracked files.
- Dual-host settlement reconciles Pi (`agent_settled`) and OMP (`agent_end` with `willContinue` flag) cleanly, guarding against duplicate summary emission via `cycleSettled`.
- Subagent model and effort preservation protects global configuration (`advisor.json`) from child-session overwrite.

---

### Critical Issues

None (0).

---

### Warnings (High / Medium Priority Findings)

1. **[Medium] Missing Dedicated Integration Test for Native Host Advisor Event Filtering**:
   - **Context**: `isNativeHostAdvisor(ctx)` (`ctx?.agent?.kind === "sub" && ctx?.agent?.id === "advisor"`) is implemented in `src/child-session.ts` and guards `before_agent_start`, `tool_call`, `tool_result`, `agent_end` in `src/tools/register-lifecycle.ts`, and `handleJevTurnEnd` in `src/tools/jev-turn-gate.ts`.
   - **Gap**: While test `test/activation.test.ts` tests subagent `{ id: "Task1", kind: "sub" }`, no test passes `{ id: "advisor", kind: "sub" }` to verify that native host advisor events are ignored by lifecycle handlers. Line coverage highlights lines 157, 202, 216, 284 in `register-lifecycle.ts` and line 121 in `jev-turn-gate.ts` as uncovered.

---

### Suggestions (Low Priority Improvements)

1. **[Low] Test Coverage Addition for Native Advisor**:
   - Add a test in `test/activation.test.ts` or `test/consultation.test.ts` invoking lifecycle handlers with `ctx.agent = { id: "advisor", kind: "sub" }` to verify no-op behavior.
2. **[Low] Doc & Script Realignment for `bun run typecheck`**:
   - `docs/development.md` references `bun run typecheck` which executes `bun check`, failing on Bun 1.4.0 (`Script not found "check"`). Consider updating `package.json` to alias `tsc --noEmit` or document `bun x tsc --noEmit`.

---

### Positive Observations

- **Fail-Closed Privacy**: `pendingWriteAdvisorArguments` strips `draft`, `includeTrackedFiles`, and `includeUntracked` from pending disclosures in Scout, defaulting to `{ content: "{}", path }` on any parsing or validation failure.
- **Symmetric Non-Advisor Counting**: `record_advisor_outcome` maintains single logical counting semantics whether called directly or via `write xd://record_advisor_outcome`.
- **Pre- vs Post-Consumption Budget Invariant**: Help, invalid follow-ups, and pre-execution aborts use 0 budget slots; once provider consultation begins post-`consumeCall`, consumed budget is preserved across errors.
- **Frozen Public Facades**: Public exports in `src/config.ts`, `src/ui.ts`, `src/tools.ts`, `src/commands.ts` remain unchanged and pass `test/facade-exports.test.ts`.
- **Clean Architecture & Zero Bloat**: No unnecessary dependencies added; production leaves strictly avoid importing facades.

---

### Validation Commands & Results

| Command | Result | Notes |
| --- | --- | --- |
| `bun test` | PASS | 585 tests passed across 62 files (5,508 assertions) |
| `bun test test/consultation.test.ts test/scout-context.test.ts test/activation.test.ts` | PASS | 55 targeted tests passed in 1.78s |
| `bun run test:node-loader` | PASS | Node DefaultResourceLoader shared bundle test passed |
| `bun x tsc --noEmit` | PASS | 0 TypeScript errors |
| `bun run check:boundaries` | PASS | Module boundaries verified: 0 violations |
| `bun run lint` | PASS | oxlint clean: 0 warnings/errors |
| `bun run format:check` | PASS | oxfmt: 430 files checked, 100% formatted |
| `bun run package:check` | PASS | Package contents verified (121 files) |
| `git diff --check` | PASS | Clean diff, 0 whitespace/conflict errors |

---

### Metrics

- **Score**: 9.5 / 10
- **TypeScript Type Safety**: 100% clean (`tsc --noEmit`)
- **Lint Issues**: 0
- **Test Pass Rate**: 100% (585/585 pass)
- **Code Coverage**: 93.96% lines, 93.05% functions across codebase
- **Module Boundary Compliance**: 100%

---

### Unresolved Questions

None. Phase 04 is verified and ready for Phase 05.
