## Code Review Summary

### Scope

- Branch: `omp/compatibility`; reviewed current working-tree implementation diff.
- Requested files: `src/commands/model-commands.ts`, `test/command-registration.test.ts`, `test/activation.test.ts`, `test/host-contracts.test.ts`, `README.md`, `docs/configuration.md`, `CHANGELOG.md`.
- Supporting evidence: `src/commands/{activation,activation-preparation}.ts`, `src/commands.ts`, `test/helpers/{harness,mock-pi,dual-host-harness}.ts`, `package.json`, `docs/development.md`, and `plans/261028-1232-advisor-on-command/{plan,phase-01-command-and-activation,phase-02-documentation,phase-03-bundle-and-integration}.md`.
- Approximately 147 added/deleted diff lines in the seven requested files; approximately 1,000 relevant supporting source/test/documentation lines inspected.
- Applied the published `code-review` skill and development rules through direct reads. No project PDR or code-standards document exists in the inspected docs inventory.
- Updated plans: none; assignment explicitly excludes TODO/task-state updates. Product files unchanged by this review.

### Summary of Changes

- Registers both `advisor` and `advisor-on` in a two-name loop, preserving the existing description and returning the same `activateAdvisor(runtime, args, ctx)` call (`src/commands/model-commands.ts:20–27`).
- Checks exactly seven registered commands and matching activation descriptions (`test/command-registration.test.ts:29–49`).
- Adds four alias cases: saved models, deferred tool registration, model/context overrides, and picker cancellation (`test/activation.test.ts:842–960`).
- Adds the alias to the shared sorted Pi/OMP bundle command inventory (`test/host-contracts.test.ts:28–35,49–61`).
- Recommends collision-free activation in README/configuration examples, preserves discoverability of Pi's legacy alias, and records the addition under Unreleased (`README.md:97–111,169–175`; `docs/configuration.md:7–9,88–91`; `CHANGELOG.md:15`).

### Overall Assessment

Production implementation is small, additive, and maintainable. No production correctness defect, breaking facade change, new security exposure, dependency, parser, host interception, or lifecycle modification identified in the reviewed diff. Two medium-priority test-quality gaps prevent the promised activation-parity acceptance from being fully demonstrated.

**Verdict: Needs Changes — strengthen the acceptance tests; no activation implementation rewrite requested.**

### Critical / High Priority Findings

None identified in the inspected changes.

### Medium Priority Findings

#### R1 — Deferred-tool test does not establish that activation awaits the mutation

- Evidence: `test/activation.test.ts:879–900` awaits the command and checks active tools. Its mock defers mutation only through `await Promise.resolve()` (`test/helpers/mock-pi.ts:134–140,196–201`).
- Failure mechanism: the mutation continuation is queued before the async activation promise completes. Merely observing tools after awaiting the handler cannot distinguish properly awaited mutation from fire-and-forget mutation when the mock resolves after a single microtask. The current production code does correctly await it (`src/commands/activation.ts:132–137`).
- Impact: regression protection for a named cross-host compatibility requirement is weaker than the test title claims; losing the await could expose stale tool state or finish the command early on OMP.
- Confidence: high, based on static promise ordering. No mutation experiment executed.
- Correction: override `setActiveTools` with an externally controlled pending promise in this test. Start the command; wait until the setter is entered; assert command completion is still pending and tool state unchanged; release the setter; await the command; assert both Advisor tools. Keep this local to the existing test/fixtures and retain legacy coverage.

#### R2 — Alias coverage omits explicit successful-activation acceptance oracles

- Evidence: `test/activation.test.ts:842–875` only checks no picker and presence of `ask_advisor`, starting with an empty tool list. The override case (`904–927`) does not inspect selected Executor and uses `activationHarness()`, whose tools start with `ask_advisor` already enabled (`test/helpers/harness.ts:95–100`). The only new alias picker case cancels (`931–960`); successful first-use selection is exercised only through `advisor` (`145–197`).
- Missing contractual evidence: the phase requires selected Executor, both Advisor tools, preservation of unrelated tools, successful first-use model selection for both names, and selected Executor after override (`plans/261028-1232-advisor-on-command/phase-01-command-and-activation.md:24–26,65–72`).
- Impact: current alias cases do not independently establish the full promised behavior matrix. Sharing production implementation reduces runtime risk but does not complete the explicitly requested regression coverage.
- Confidence: high; direct comparison of assertions and acceptance criteria.
- Correction: parameterize a bounded saved-model/successful-picker/override subset over both names, or extend focused alias cases. Start disabled with an unrelated tool, assert selected Executor and both Advisor tools, retain the unrelated tool, and exercise successful first-use selection with independently specified persisted refs/readiness notice. Preserve existing cancellation and legacy cases.

### Low Priority Suggestions

- Current configuration subsections at `docs/configuration.md:70,221` still describe activation using only `/advisor`; adding the preferred spelling would improve consistency with the updated OMP guidance. This does not invalidate the new command behavior.
- Existing startup recovery text at `src/commands/activation-preparation.ts:92–99` still recommends `/advisor`. It predates this diff and is explicitly outside Phase 01's allowed help-text changes (`phase-01-command-and-activation.md:27`); not treated as a new blocking defect.

### Positive Observations

- Both handlers forward original arguments/context and return the activation promise; no asynchronous wrapper or duplicate activation logic.
- Legacy `advisor` registration and existing tests retained. Existing public-facade export test unchanged (`test/command-registration.test.ts:24–28`); facade files absent from observed change inventory.
- Validation/authentication, rollback of in-memory refs on cancellation/error, successful model persistence, subagent restrictions, and awaited tool mutation remain in the shared pipeline (`src/commands/activation.ts:72–137`). No alias-specific security bypass introduced.
- No new per-turn work, provider request path, secret handling, or configuration schema. Additional startup work limited to one command registration.
- Dual-host command ordering remains correct, with both host probes using the same independent inventory.

### Verification and Limitations

- Per assignment ownership, did not run builds, tests, typecheck, lint, formatters, or host smoke. No passing checks claimed.
- `dist/index.js` appeared in the change inventory, but direct diff access was denied by the active `dist/` access policy; bundle contents/build freshness not independently reviewed.
- Registration probes check packaged loading, not interactive slash dispatch (`test/host-contracts.test.ts:49–61`). Fresh-process OMP/Pi routing and native `/advisor` independence remain Main-owned integration evidence, as specified in Phase 03.
- Parent should collect the planned build, test, typecheck, boundaries, lint, package checks, and isolated fresh-host smoke after addressing test findings. Do not treat this static review as runtime qualification.

### Metrics

- Type coverage: not measured.
- Test coverage: not measured; two identified acceptance-test gaps.
- Linting issues: not measured.
- Findings: 0 critical, 0 high, 2 medium; documentation suggestions nonblocking.

### Unresolved Questions

None requiring product/design input. Generated-bundle inspection and runtime qualification remain unverified surfaces, not assumed successes.
