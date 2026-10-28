# Phase 03: Dual-Host System Prompt Injection & `xd://` Transport Instructions

## Context Links

- [Overview Plan](plan.md)
- [Design Decisions & Phase Contracts](research/design-decisions.md)
- [Prompt, Settings & Lifecycle Research](research/prompt-settings-research.md)
- [Requirement and Verification Matrix](reports/acceptance-matrix.md) (`P1`–`P4`)
- [Pi Extension Docs](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)
- [Phase 01 — Host Contracts](phase-01-host-contracts.md)
- [Phase 02 — TUI Compatibility](phase-02-tui-compatibility.md)

## Overview

- **Date**: 2026-10-11
- **Priority**: P2
- **Implementation Status**: DONE (100% — 2026-10-11)
- **Review Status**: Approved (10/10 — 2026-10-11)
- **Owner**: Prompt owner
- **Depends On**: [Phase 01 — Host Contracts](phase-01-host-contracts.md) (runs in parallel with Phase 02; **must complete before Phase 04** because both edit `src/tools/register-lifecycle.ts`)
- **Scope**: Restore system-prompt injection in OMP via `before_agent_start` returned `{ systemPrompt: string[] }` while preserving Pi 1.x `systemPromptOptions.sections`, own and deduplicate a uniquely delimited `pi-advisor-flow` block (preserving any foreign block even with the same human heading), and load conditional routing + gate instructions from static `.md` prompt assets bundled at build time.

## Key Insights

- `registerToolLifecycle` (`src/tools/register-lifecycle.ts`) checks `const sections = event.systemPromptOptions?.sections; if (!sections) return;`. Because OMP's `BeforeAgentStartEvent` (`types.ts`) provides `event.systemPrompt: string[]` instead of `systemPromptOptions`, `pi-advisor` returns early and injects zero guidelines in OMP (cite symbols first; re-verify OMP lines at implementation kickoff due to working-tree drift).
- In OMP, `emitBeforeAgentStart` (`runner.ts`) replaces `currentSystemPrompt` when a handler returns `{ systemPrompt: string[] }`, and `#prepareAgentStart` (`agent-session.ts`) retries up to `AGENT_START_POLICY_MAX_ATTEMPTS = 3` per turn. Returning `undefined` when no changes are needed preserves `baseXdevCatalogDelivered: true`.
- OMP mounts discoverable extension tools under `xd://ask_advisor` (and `xd://record_advisor_outcome`) while keeping `"ask_advisor"` in `pi.getActiveTools()`. Promoting tools to `loadMode: "essential"` or parsing host prompt prose to guess transport is unnecessary and fragile: a single **conditional routing instruction** tells the Executor to use `xd://ask_advisor` (via `read` for schema when needed + `write` with JSON `content`) when advertised as an `xd://` device, or call `ask_advisor` when directly exposed.
- Stripping blocks by a generic `"Advisor invocation settings:\n"` prefix could delete another extension's or user's block that happens to share the same human heading. Wrapping the plugin's block in unique `pi-advisor-flow` delimiters guarantees only the plugin-owned block is replaced or removed.
- Existing settings booleans (`simpleMode`, `advisorPlanGate`, `advisorFailureGate`, `advisorCompletionGate`, `advisorCustomInvocation`) already exist in `src/config/state.ts`; preserve public and unknown `advisor.json` fields without adding duplicate keys.

## Requirements

### Functional Requirements

1. Move Executor invocation instruction templates out of inline TypeScript strings into static Markdown assets under `src/tools/prompts/*.md` (created in this phase, bundled inline into `dist/index.js` via `package.json#scripts.build` `--loader .md:text` and typed via `src/tools/prompt-assets.d.ts`; do not implement template prose during planning).
2. Keep `advisorInvocationGuidelines(): string[]` in `src/tools/prompts.ts` as a 0-arg function (no `AdvisorTransport` option, no prose substring parsing of `event.systemPrompt`):
   - Emit conditional routing instructions referencing the host-advertised schema/catalog: when the host advertises `xd://ask_advisor`, read `xd://ask_advisor` for its schema when needed and write JSON `content` (`"{}"` by default, or JSON with `draft`, `question`, `followUpTo`, `gitContext`) to `xd://ask_advisor` (and write JSON `content` to `xd://record_advisor_outcome` when advertised); when `ask_advisor` (or `record_advisor_outcome`) is directly exposed as a tool, call it directly.
   - When `isSimpleMode() === true`, emit only the single voluntary on-demand rule from `src/tools/prompts/simple-mode.md` (no budget line, no gate rules).
   - When `isSimpleMode() === false`, assemble enabled gate rules from `plan-gate.md` (`advisorPlanGateRef`), `failure-gate.md` (`advisorFailureGateRef`), `completion-gate.md` (`advisorCompletionGateRef`), custom trigger rule (`advisorCustomInvocationRef`), and default invocation/routing rule (`invocation-routing.md`).
   - Replace/update any existing tests that pinned old direct-only wording to assert semantic policy presence/absence rather than re-pinning exact boilerplate strings.
3. Update `before_agent_start` in `src/tools/register-lifecycle.ts` to support both hosts using a **uniquely delimited owned block**:
   - Define module-private delimiters `ADVISOR_PROMPT_BLOCK_START = "<!-- pi-advisor-flow:invocation-settings:start -->"` and `ADVISOR_PROMPT_BLOCK_END = "<!-- pi-advisor-flow:invocation-settings:end -->"`.
   - **Pi 1.x (`event.systemPromptOptions?.sections`)**: delete `sections.advisor_invocation_settings`, set `sections.advisor_invocation_settings` when active guidelines are non-empty, and return `undefined`.
   - **OMP (`Array.isArray(event.systemPrompt)`)**: strip **only** elements delimited by `ADVISOR_PROMPT_BLOCK_START` and `ADVISOR_PROMPT_BLOCK_END`, preserving all other elements (including any foreign block that starts with the human heading `"Advisor invocation settings:"`) byte-for-byte and in order. Return `{ systemPrompt: [...cleaned, ownedBlock] }` when active, or `hadOwnedBlock ? { systemPrompt: cleaned } : undefined` when inactive/disallowed.
   - **Unsupported event shape**: warn once per lifecycle instance without throwing or corrupting the prompt.
4. Enforce all activation and access guards before injecting on both hosts:
   - `pi.getActiveTools().includes("ask_advisor")` must be true.
   - `loadConfig(ctx)` loads global `advisor.json`.
   - `advisorModelAccess(ctx).allowed` must be true and `sameModelAdvisorDisabled(ctx)` must be false.
5. Follow `/home/loidinh/WS/pi-advisor/AGENTS.md`: read [Pi extension docs](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md) before hook changes; keep `src/tools.ts` facade exports frozen (`test/facade-exports.test.ts`); single-line comments only when 100% needed; keep tool-action blocking and session blocking distinct; no commits unless requested; no broad cleanup. Forbid `any`, `ReturnType`, and source-text regex tests.

### Explicit Three-Layer Distinction

| Layer                            | Governing Mechanism                                                                                                                                                                                                                      | Proof Boundary                                                                                                                              |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Config allow / activation** | `pi.getActiveTools().includes("ask_advisor")` (startup `discoverable` mount vs `/advisor-off`), `alwaysOn` (restores model pair at main `session_start`, NOT per-turn consultation), `advisorModelWhitelist`, `advisorDisableSameModel`. | Unit/integration check on `before_agent_start` guard return and active tool list.                                                           |
| **2. Prompt influence**          | `simpleMode` (`true` suppresses gates/budget; `false` enables `advisorPlanGate`, `advisorFailureGate`, `advisorCompletionGate`, `advisorCustomInvocation`).                                                                              | Outbound system prompt contains or omits the semantic gate policies and conditional `xd://ask_advisor` / `ask_advisor` routing instruction. |
| **3. Observed provider call**    | Cooperative Executor calls `write xd://ask_advisor` or `ask_advisor`, or deterministic `autoLoopGate` triggers in `tool_call`.                                                                                                           | Captured Advisor/Scout provider request and `session.consumedCalls` transition; prompt injection alone never counts as an Advisor call.     |

## Architecture

### 1. Static `.md` Instruction Assets & Bundling Contract (`src/tools/prompts.ts`)

- Static Markdown assets imported via static text imports in `src/tools/prompts.ts` (bundled into `dist/index.js` by `bun build --loader .md:text` so Node `DefaultResourceLoader` and OMP require zero runtime filesystem reads):
  - `src/tools/prompt-assets.d.ts` (Create): ambient `declare module "*.md" { const content: string; export default content; }`.
  - `src/tools/prompts/simple-mode.md` (Create): voluntary second-opinion rule when uncertain, using conditional `xd://ask_advisor` device vs direct `ask_advisor` routing.
  - `src/tools/prompts/plan-gate.md` (Create): pre-plan review instruction requiring a concise `draft` naming proposed work, validation, and remaining risks (noting a draft claim is not verification evidence).
  - `src/tools/prompts/failure-gate.md` (Create): repeated-failure / stalled-progress review instruction after two consecutive materially equivalent failures or no-progress actions.
  - `src/tools/prompts/completion-gate.md` (Create): pre-completion review instruction requiring a concise `draft` naming changed work, validation, and remaining risks except for demonstrably trivial work.
  - `src/tools/prompts/invocation-routing.md` (Create): conditional transport & default empty-payload instruction (`"{}"` written to `xd://ask_advisor` when advertised as an `xd://` device after reading `xd://ask_advisor` for schema if needed, or `{}` passed to `ask_advisor` when directly exposed; plus `xd://record_advisor_outcome` vs `record_advisor_outcome` outcome recording; omit invented `question` unless a specific assumption/trade-off is under review).
- **`advisorInvocationGuidelines()` assembly algorithm**:
  1. Normalize each imported `.md` asset with `.trim()`.
  2. If `isSimpleMode()` is `true`, **return** `[simpleModeRule]`.
  3. Otherwise, collect enabled gate rules in order: `planGateRule` when `advisorPlanGateRef`, `failureGateRule` when `advisorFailureGateRef`, `completionGateRule` when `advisorCompletionGateRef`, and custom rule referencing `advisorCustomInvocationRef` when non-empty.
  4. When at least one gate rule is enabled, append `invocationRoutingRule` and **return** the array.

### 2. Uniquely Delimited Dual-Host `before_agent_start` Algorithm (`src/tools/register-lifecycle.ts`)

- Keep `ADVISOR_PROMPT_BLOCK_START`, `ADVISOR_PROMPT_BLOCK_END`, `isOwnedAdvisorBlock`, and `buildActiveAdvisorBody` module-private inside `src/tools/register-lifecycle.ts`:
  1. **`isOwnedAdvisorBlock(block: unknown): boolean`**:
     - Returns `true` iff `typeof block === "string"` and `block.startsWith(`${ADVISOR_PROMPT_BLOCK_START}\n`)` and `block.endsWith(`\n${ADVISOR_PROMPT_BLOCK_END}`)`.
     - Any foreign block — including a block from another extension or user config that begins with `"Advisor invocation settings:\n"` without the `pi-advisor-flow` start/end delimiters — returns `false` and is never stripped.
  2. **`buildActiveAdvisorBody(pi, ctx, session): string | undefined`**:
     - Return `undefined` if `!pi.getActiveTools().includes("ask_advisor")`.
     - Call `loadConfig(ctx)`. Return `undefined` if `!advisorModelAccess(ctx).allowed || sameModelAdvisorDisabled(ctx)`.
     - Call `const guidelines = advisorInvocationGuidelines()`.
     - Compute `budget = isSimpleMode() ? undefined : session.remainingCalls(getAdvisorMaxCallsPerSession())`; when `budget !== undefined`, append the remaining session call budget rule.
     - Return `guidelines.length > 0 ? `Advisor invocation settings:\n${guidelines.map((rule) => `- ${rule}`).join("\n")}` : undefined`.
  3. **Handler execution in `pi.on("before_agent_start", (event, ctx) => ...)`**:
     - Read `sections = event?.systemPromptOptions?.sections` and `promptArray = Array.isArray(event?.systemPrompt) ? event.systemPrompt : undefined`.
     - If neither `sections` nor `promptArray` is present: warn once per lifecycle instance (`unsupportedPromptShapeNotified`) when `event` carries an unrecognized non-empty prompt container, and **return `undefined`**.
     - If `sections` is present (Pi 1.x): delete `sections.advisor_invocation_settings`, compute `body = buildActiveAdvisorBody(pi, ctx, session)`, assign `if (body) sections.advisor_invocation_settings = body`, and **return `undefined`**.
     - If `promptArray` is present (OMP):
       - Filter `cleaned = promptArray.filter((block) => !isOwnedAdvisorBlock(block))` and set `hadOwnedBlock = cleaned.length !== promptArray.length`.
       - Compute `body = buildActiveAdvisorBody(pi, ctx, session)`.
       - If `!body`, **return** `hadOwnedBlock ? { systemPrompt: cleaned } : undefined`.
       - Wrap `ownedBlock = `${ADVISOR_PROMPT_BLOCK_START}\n${body}\n${ADVISOR_PROMPT_BLOCK_END}`` and **return** `{ systemPrompt: [...cleaned, ownedBlock] }`.

## Related Code Files

| File Path                                                             | Action | Role / Ownership                                                                                                                                                 |
| --------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/home/loidinh/WS/pi-advisor/src/tools/prompt-assets.d.ts`            | Create | Ambient `*.md` text module declaration for TypeScript (`bun check`)                                                                                              |
| `/home/loidinh/WS/pi-advisor/src/tools/prompts/simple-mode.md`        | Create | Static Markdown instruction template for Simple mode                                                                                                             |
| `/home/loidinh/WS/pi-advisor/src/tools/prompts/plan-gate.md`          | Create | Static Markdown instruction template for Plan gate                                                                                                               |
| `/home/loidinh/WS/pi-advisor/src/tools/prompts/failure-gate.md`       | Create | Static Markdown instruction template for Failure gate                                                                                                            |
| `/home/loidinh/WS/pi-advisor/src/tools/prompts/completion-gate.md`    | Create | Static Markdown instruction template for Completion gate                                                                                                         |
| `/home/loidinh/WS/pi-advisor/src/tools/prompts/invocation-routing.md` | Create | Static Markdown instruction template for conditional `xd://` vs direct routing and default payload                                                               |
| `/home/loidinh/WS/pi-advisor/src/tools/prompts.ts`                    | Modify | Import static `.md` assets and assemble `advisorInvocationGuidelines()` without prose parsing or new options                                                     |
| `/home/loidinh/WS/pi-advisor/src/tools/register-lifecycle.ts`         | Modify | Implement dual-host `before_agent_start` (`sections` + `systemPrompt: string[]`) with unique `pi-advisor-flow` block delimiters (Sequential handoff to Phase 04) |
| `/home/loidinh/WS/pi-advisor/scripts/check-package.mjs`               | Modify | Single integration owner registers `src/tools/prompt-assets.d.ts` and `src/tools/prompts/*.md` in sorted `expectedFiles`                                         |
| `/home/loidinh/WS/pi-advisor/test/default-resource-loader.node.mjs`   | Modify | Verify bundled `dist/index.js` loads static `.md` prompt assets under Node `DefaultResourceLoader` with zero runtime file reads                                  |
| `/home/loidinh/WS/pi-advisor/test/consultation.test.ts`               | Modify | Replace old exact direct-wording assertions with semantic policy and conditional routing assertions across Pi `sections` and OMP `string[]`                      |
| `/home/loidinh/WS/pi-advisor/test/activation.test.ts`                 | Modify | Add dual-host `before_agent_start` composition, retry deduplication, foreign-heading preservation, and `/advisor-off` removal tests                              |
| `/home/loidinh/WS/pi-advisor/test/model-whitelist.test.ts`            | Modify | Verify disallowed/same-model Executor strips only the delimited owned block and returns `undefined` when clean                                                   |
| `/home/loidinh/WS/pi-advisor/test/budget.test.ts`                     | Modify | Verify remaining session budget line appears in `simpleMode: false` and is omitted in `simpleMode: true` on OMP `string[]`                                       |

## Implementation Steps

1. **Create Static `.md` Instruction Assets & Ambient Declaration**:
   - Create `src/tools/prompt-assets.d.ts` and the five static `.md` files under `src/tools/prompts/`.
   - Update `src/tools/prompts.ts` to import the `.md` files statically and assemble `advisorInvocationGuidelines()`.
   - Register the 6 new `src/tools/**` files in `scripts/check-package.mjs` `expectedFiles` (sorted).
2. **Update `before_agent_start` in `/home/loidinh/WS/pi-advisor/src/tools/register-lifecycle.ts`**:
   - Implement private `ADVISOR_PROMPT_BLOCK_START` / `ADVISOR_PROMPT_BLOCK_END`, `isOwnedAdvisorBlock`, `buildActiveAdvisorBody`, and the dual-host `sections` / `systemPrompt: string[]` branch.
   - Leave `tool_call`, `tool_result`, and settlement hooks untouched for Phase 04 (`phase-04-device-lifecycle-safety.md`).
3. **Update Existing Wording Tests & Add Dual-Host Boundary Tests**:
   - Update `test/consultation.test.ts`, `test/activation.test.ts`, `test/model-whitelist.test.ts`, `test/budget.test.ts`, and `test/default-resource-loader.node.mjs` to assert semantic policy presence/absence, unique delimiter ownership, preservation of foreign `"Advisor invocation settings:"` blocks, and real isolated OMP runner `before_agent_start` behavior via `test/helpers/dual-host-harness.ts`.

## Todo List

- [x] Create `src/tools/prompt-assets.d.ts` and `src/tools/prompts/{simple-mode,plan-gate,failure-gate,completion-gate,invocation-routing}.md`, and wire static imports in `src/tools/prompts.ts`
- [x] Register the created `src/tools/**` asset files in `scripts/check-package.mjs` `expectedFiles`
- [x] Update `before_agent_start` in `src/tools/register-lifecycle.ts` with unique `pi-advisor-flow` block delimiters and dual-host `sections` / `systemPrompt: string[]` support
- [x] Replace old wording assertions in `test/consultation.test.ts` and add dual-host boundary tests in `test/activation.test.ts`, `test/model-whitelist.test.ts`, `test/budget.test.ts`, and `test/default-resource-loader.node.mjs`

## Success Criteria

- **Future implementation verification gates (`reports/acceptance-matrix.md` `P1`–`P4`; not claimed complete during planning)**:
  1. `P1`/`P3`: When `event.systemPrompt` contains `["System header", "Advisor invocation settings:\n- Foreign extension rule", "## Devices\n- xd://ask_advisor"]` and `simpleMode: false` with all gates `true`, `before_agent_start` returns `{ systemPrompt }` where elements `0..2` (including the foreign `"Advisor invocation settings:"` block) are preserved byte-for-byte in order and element `3` is wrapped in `ADVISOR_PROMPT_BLOCK_START`/`END` with Plan, Failure, Completion, conditional `xd://ask_advisor` / `ask_advisor` routing, and remaining budget policies.
  2. `P2`: Running `before_agent_start` 3 consecutive times (simulating OMP `#prepareAgentStart` retries) produces exactly 1 delimited `pi-advisor-flow` block, replacing rather than duplicating it while keeping foreign blocks untouched.
  3. `P2`/`P3`: Independent toggles for `advisorPlanGate`, `advisorFailureGate`, `advisorCompletionGate`, `advisorCustomInvocation`, and `simpleMode` include or omit only the corresponding semantic policy in both Pi `sections` and OMP `string[]`.
  4. `P2`/`P4`: When `"ask_advisor"` is inactive, or `advisorModelAccess(ctx).allowed === false`, or `sameModelAdvisorDisabled(ctx) === true`, `before_agent_start` strips only the uniquely delimited `pi-advisor-flow` block and returns `undefined` when already clean.
  5. Focused Phase 03 verification commands and isolated OMP provider-boundary smoke pass:
     ```bash
     bun --cwd /home/loidinh/WS/pi-advisor run build
     bun --cwd /home/loidinh/WS/pi-advisor test test/consultation.test.ts test/activation.test.ts test/model-whitelist.test.ts test/budget.test.ts test/facade-exports.test.ts
     bun --cwd /home/loidinh/WS/pi-advisor run test:node-loader
     bun --cwd /home/loidinh/WS/pi-advisor run typecheck
     bun --cwd /home/loidinh/WS/pi-advisor run check:boundaries
     bun --cwd /home/loidinh/WS/pi-advisor run package:check
     ```

## Risk Assessment

| Risk                                                                              | Impact | Mitigation                                                                                                                                    |
| --------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Merge conflict on `src/tools/register-lifecycle.ts` with Phase 04                 | High   | Enforce strict sequential dependency: Phase 04 starts only after Phase 03 finishes editing `register-lifecycle.ts`.                           |
| Deleting a foreign block that shares the `"Advisor invocation settings:"` heading | High   | Match and strip only blocks bounded by `ADVISOR_PROMPT_BLOCK_START` and `ADVISOR_PROMPT_BLOCK_END`.                                           |
| Unregistered `.md` assets fail `scripts/check-package.mjs` or Node ESM loader     | Medium | Bundle `.md` files into `dist/index.js` via `--loader .md:text` and register all created `src/tools/**` files in `scripts/check-package.mjs`. |

## Security Considerations

- Never strip or mutate another extension's system prompt block or OMP's safety/permissions instructions; match only the uniquely delimited `pi-advisor-flow` block.
- Enforce `advisorModelAccess(ctx)` and `sameModelAdvisorDisabled(ctx)` before injecting any prompt block.

## Next Steps

- Hand off `src/tools/register-lifecycle.ts` to **Phase 04** (`phase-04-device-lifecycle-safety.md`) for `xd://ask_advisor` outer/inner `tool_call`/`tool_result` normalization, Scout pending-invocation disclosure filtering, guarded host-specific settlement, and child-session isolation.

## Unresolved Questions

- None. Provider-boundary prompt capture and live model compliance remain future implementation gates.
