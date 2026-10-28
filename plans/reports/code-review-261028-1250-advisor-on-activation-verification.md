## Code Review Summary

### Scope

- Primary: `test/activation.test.ts:841–1060` (220 lines).
- Supporting: `src/commands/activation.ts:66–152`, `src/commands/model-commands.ts:20–27`, `test/helpers/harness.ts:95–136`, `test/helpers/mock-pi.ts:146–206`, selector/registry helpers at `test/activation.test.ts:46–89`, prior report `plans/reports/code-review-261028-1243-advisor-on-command.md:30–46`.
- Read published code-review skill/development rules and README/development documentation. Project PDR/code-standards files absent from discovered docs.
- Updated plans: none. No product/test edits.

### Overall Assessment

**Verdict: Needs Changes.** Expanded activation assertions address prior R2. The external barrier removes timers but does not strictly prove awaiting mutation: prior R1 remains open because the test can observe completion too early, then release the mutation before its completion assertions.

### Critical / High Priority Findings

None identified in this bounded review.

### Medium Priority Finding

#### R1 — Barrier test still permits a missing-await regression

- Evidence: setter signals entry before awaiting its externally released barrier (`test/activation.test.ts:904–909`). Handler completion is recorded in `.then` (`919–924`). The test immediately checks pending state upon entry, releases the barrier, then checks final state only after awaiting the handler (`926–934`). Actual production handler directly returns `activateAdvisor` (`src/commands/model-commands.ts:25`), whose tool mutation is currently awaited (`src/commands/activation.ts:133–137`).
- **[INFERENCE; high confidence, static Promise-ordering analysis]** Removing the production `await` still satisfies these assertions:
  1. `signalMutationReached` queues the test continuation before the activation completion callback.
  2. The test resumes and observes `handlerSettled === false`, even though activation is no longer waiting for tool mutation.
  3. `releaseTools` queues the mutation continuation. The already-queued handler callback sets `handlerSettled = true` and resolves `activationPromise`.
  4. The mutation continuation runs before the test resumes from `await activationPromise`; both final flags are therefore true.
- Impact: test is timer-free but does not reject the exact missing-await failure it claims to prevent. OMP early completion/stale tool-state regression remains unprotected.
- Correction: assert or snapshot `toolsSettled` **inside the handler completion callback**, not only after awaiting that callback. For example:
  ```ts
  .then(() => {
    expect(toolsSettled).toBe(true);
    handlerSettled = true;
  });
  ```
  Keep existing external barriers, pending-state assertions, release, and exact final tools check. A missing await then reaches the callback before tool mutation and fails deterministically, without timers. Main should verify the corrected test rejects a missing-await mutant and passes with the real implementation.

### Activation Assertion Coverage — Prior R2 Addressed

- Persisted models: asserts no picker, exact selected Executor, and exact active-tools list retaining `unrelated-tool` plus both `ask_advisor` and `record_advisor_outcome` (`841–883`, especially `873–881`).
- Deferred mutation: checks both tools and preservation of `preexisting-tool` (`933–939`), subject to R1's ordering gap.
- First-use success: exercises real selector helper; asserts chosen Executor/Advisor/fallback option sequence, persisted Executor/Advisor refs, both enabled tools, and readiness notice (`944–992`, especially `975–991`). Here `selectedModels` records picker results; actual Executor `setModel` selection is independently asserted in persisted-model and override cases.
- Explicit overrides: asserts saved refs/context budget, exact selected Executor, both tools, and loaded budget (`995–1028`, especially `1014–1026`).
- First-use cancellation retained: no saved configuration and no active tools (`1031–1059`).

### Positive Observations

- Local externally controlled `Promise.withResolvers` barriers; no wall-clock timers in the revised regression test.
- Independent expected model/tool values and exact tool-list equality catch omissions and unrelated-tool loss.
- Production activation still correctly awaits tool mutation; no production rewrite requested.

### Verification / Metrics

- Static review only; no tests, build, typecheck, lint, formatting, or mutation experiment run under main-owned verification constraints.
- The statement that all 594 tests/typecheck/lint/formatting pass is not independently verified by this review.
- Findings: 0 critical, 0 high, 1 medium. Runtime/type/test coverage percentages not measured.

### Recommended Actions

1. Add completion-time tool-state assertion/snapshot to the barrier test.
2. Main validates regression sensitivity and collects required project-check results.

### Unresolved Questions

None requiring product/design input. Runtime check outcomes remain unverified.
