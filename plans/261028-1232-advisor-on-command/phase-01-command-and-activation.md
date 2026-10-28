# Phase 01 — Command registration and activation parity

## Overview

- Priority: P2. Status: pending. Effort: 20m. Dependency: none.
- Owner: implementation owner assigned by Main. Output: additive alias and meaningful regression coverage, no host-specific branch.
- Context: [overview](plan.md); [registration](../../src/commands/model-commands.ts); [activation](../../src/commands/activation.ts); [registration tests](../../test/command-registration.test.ts); [activation tests](../../test/activation.test.ts).

## Design and file ownership

Modify only:

- `/home/loidinh/WS/pi-advisor/src/commands/model-commands.ts`: register `advisor-on` alongside `advisor`.
- `/home/loidinh/WS/pi-advisor/test/command-registration.test.ts`: seven-command inventory and description parity.
- `/home/loidinh/WS/pi-advisor/test/activation.test.ts`: activation parity coverage.

No product files created/deleted. Do not change `activation.ts`, parsing, configuration storage, runtime identity or other command behavior. Existing flow is `registerModelCommands -> activateAdvisor(runtime, args, ctx)` for both names. A small local two-name registration loop may share the existing descriptor; no reusable alias framework or host detection needed.

## Task: register-advisor-on

1. Preserve the current activation description verbatim. Register both `advisor-on` and `advisor`, each delegating `(args, ctx) => activateAdvisor(runtime, args, ctx)`; no separate activation logic and no manual slash parsing.
2. Rename the six-command registration test to seven. Assert `commands.size === 7`, all previous command names plus `advisor-on`, and equal activation descriptions. Do not require handler object identity.
3. In `test/activation.test.ts`, reuse `withAgentDir`, `activationHarness`, `activationContext`, registry fixtures and the real registered handlers. Parameterize a bounded set of existing activation cases over `advisor` and `advisor-on`, or add focused alias cases while retaining legacy coverage. Avoid duplicating the full suite or introducing new fixture modules.
4. Cover saved-model activation: start disabled; invoke the command; assert the configured Executor is selected, both `ask_advisor` and `record_advisor_outcome` become active, and existing non-Advisor tools remain available.
5. Cover first-use model selection and cancellation for both names using existing picker fixtures. Successful selection persists selected models and announces readiness; cancellation leaves tools/config unchanged. Keep expected values independently specified, not derived from the legacy handler's output.
6. Cover argument forwarding with `executor=provider/executor`, `advisor=provider/advisor`, and `contextMaxChars=5000` against distinct available models. Assert selected Executor, saved model refs, and saved/effective context limit. Include the existing deferred `setActiveTools` case for the new spelling so awaiting the handler observes activation; `/advisor-off` still disables the flow.
7. Leave the existing error/authentication/subagent rules in the shared activation pipeline. Do not add retries, input exceptions or change help text embedded elsewhere merely to rename historical `/advisor` references.

## Test design and failure modes

| Behavior/risk              | Existing evidence and gap                               | Layer/oracle                                                                                           | Candidate defect rejected                            |
| -------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| Alternate command exported | Six names asserted; new name absent                     | Extension registration inventory: exactly seven, old names retained                                    | Missing alias or removed backward-compatible command |
| Real activation            | Legacy picker/saved-model coverage; alias not exercised | Registered handler invokes real activation; selected model, active tools, notices and persisted config | Alias wired to wrong/no-op handler                   |
| Forwarding and completion  | Legacy context/deferred-tool tests only                 | Explicit expected arguments/state after awaited handler                                                | Dropped args or unreturned asynchronous activation   |
| Cancellation isolation     | Legacy cancellation test                                | Empty initial config/tools remain unchanged                                                            | Alias bypasses picker or enables prematurely         |

Mocks remain at host/model-registry/UI boundaries; never replace `activateAdvisor` with a stub. Isolate fixture state per invocation; do not run cases concurrently against global configuration refs. No provider requests or real user config mutations needed.

## Acceptance, handoff and rollback

- Seven commands registered; descriptions equal; both activation names satisfy the matrix without replacing legacy coverage.
- Main runs verification only after all phases land. Suggested focused diagnostic: `bun test test/command-registration.test.ts test/activation.test.ts`; final required checks are in Phase 03. This phase does not claim test execution.
- Failure: report actual behavioral discrepancy; do not broaden writable scope, skip assertions or modify activation semantics to force success. Escalate a required additional writable file to Main.
- Rollback: remove only this phase's alias and test changes, preserving unrelated edits; Phase 03 regenerates the corresponding bundle.

## Durable task contract

```evcrate-tasks
[
  {
    "id": "register-advisor-on",
    "title": "Register advisor-on and cover activation parity with advisor",
    "blocked_by": [],
    "allowed_files": [
      "src/commands/model-commands.ts",
      "test/command-registration.test.ts",
      "test/activation.test.ts"
    ],
    "constraints": [
      "Retain advisor and all other existing commands; reuse activateAdvisor and the exact activation description.",
      "No activation/parser/config/runtime changes, host branching, new dependencies or fixture modules; escalate additional writes to Main.",
      "Reuse isolated fixtures and real registered handlers; skip builds, tests, lint and formatters during implementation."
    ],
    "acceptance": [
      "Exactly seven commands include advisor-on and advisor with identical descriptions.",
      "Both names activate saved or interactively selected models, preserve cancellation, forward model/context overrides and await tool activation.",
      "Legacy activation coverage remains and successful activation preserves unrelated active tools."
    ],
    "verification": [
      "Main runs the final Phase 03 checks after all changes land; the focused registration/activation suite can diagnose failures.",
      "Inspect behavioral assertions for model selection, both Advisor tools, configuration values and cancellation rather than handler identity or mocked activation."
    ]
  }
]
```

- [ ] <!-- evcrate-task:register-advisor-on --> Register alias and activation parity coverage
