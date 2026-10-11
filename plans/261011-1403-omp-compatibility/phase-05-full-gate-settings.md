# Phase 05: Full Gate Settings & Configuration Roundtrip

## Context Links

- Plan Overview: [`./plan.md`](./plan.md)
- Acceptance Matrix: [`./reports/acceptance-matrix.md`](./reports/acceptance-matrix.md) (Scenarios `T4`, `S1`–`S4`)
- Fork Rules: [`../../AGENTS.md`](../../AGENTS.md) & [Pi Extension Docs](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)
- Planning Brief: [`./research/planning-brief.md`](./research/planning-brief.md)
- Design Decisions: [`./research/design-decisions.md`](./research/design-decisions.md)
- Prompt & Settings Research: [`./research/prompt-settings-research.md`](./research/prompt-settings-research.md)
- TUI & Packaging Research: [`./research/tui-packaging-research.md`](./research/tui-packaging-research.md)
- Prerequisite Phases: [`./phase-01-host-contracts.md`](./phase-01-host-contracts.md), [`./phase-02-tui-compatibility.md`](./phase-02-tui-compatibility.md), [`./phase-03-prompt-injection.md`](./phase-03-prompt-injection.md), [`./phase-04-device-lifecycle-safety.md`](./phase-04-device-lifecycle-safety.md)
- Dependent Phase: [`./phase-06-integration-and-installation.md`](./phase-06-integration-and-installation.md)

## Overview

- **Date**: 2026-10-11
- **Priority**: P1 (Settings UX clarity, gate toggle roundtrip, and global config preservation)
- **Implementation Status**: DONE (2026-10-11) / 100%
- **Review Status**: Approved (10/10 — 2026-10-11, 589/589 tests passing)
- **Owner**: `settings` / integration (starts after Phases 2, 3, and 4 complete; baseline fork `df0fc3f17bfab7d52e3f64704015e0493dfd9e01` v0.13.0)

## Key Insights

1. **No New Gate Setting Family Required**: `pi-advisor` already defines and persists `simpleMode`, `alwaysOn`, `advisorPlanGate`, `advisorFailureGate`, `advisorCompletionGate`, `advisorCustomInvocation`, `advisorAutoLoopGate`, `advisorLoopThreshold`, `advisorMaxCallsPerSession`, `advisorBlockOnBlocked`, and `gateFailureMode` (`src/config/defaults.ts:72-160`, `src/config/schema.ts`). Adding a parallel `fullGates` key, preset, or migration would duplicate state and violate YAGNI.
2. **Why Full Gates Were Suppressed in User Config**: `advisorPlanGate`, `advisorFailureGate`, and `advisorCompletionGate` already default to `true` in `resetDefaults()`. Full gate instructions were absent in OMP for two reasons: (a) `before_agent_start` returned early when `event.systemPromptOptions?.sections` was missing (fixed in Phase 3), and (b) the user's global `~/.omp/agent/advisor.json` has `"simpleMode": true`, which intentionally hides advanced gate rows in `/advisor-settings` (`src/ui/settings-items.ts:369-381`) and collapses `advisorInvocationGuidelines()` to a single voluntary rule (`src/tools/prompts.ts:142-146`).
3. **Default `true` vs Explicit `false` vs Global-Only Layering**:
   - `loadConfig` (`src/config/storage.ts:166-201`) loads only `join(getAgentDir(), "advisor.json")` (`~/.omp/agent/advisor.json` in OMP, `~/.pi/agent/advisor.json` in Pi); repo-local config files are ignored.
   - When `simpleMode` is `false` (default), each gate (`advisorPlanGate`, `advisorFailureGate`, `advisorCompletionGate`, `advisorAutoLoopGate`) is active unless explicitly set to `false` in global `advisor.json`.
   - `saveConfig` merges changed keys into existing disk JSON (`applyChangedConfigValues` in `src/config/storage.ts:84-115`), preserving unknown keys and untouched settings.
4. **UI Descriptions Need Semantic Precision**: Current row descriptions in `src/ui/settings-items.ts:352-478` do not clearly distinguish that `Always on` restores flow activation at session startup (not an automatic consultation every turn), `Simple mode` suppresses advanced prompt instructions and loop gates, and `Plan gate` / `Failure gate` / `Completion gate` / `Custom invocation` are cooperative Executor system-prompt instructions while `Automatic loop gate` is a deterministic `tool_call` interceptor.

## Requirements

### Functional

- Reuse existing boolean and string/number settings keys; introduce **zero** new config schema keys or migrations.
- Preserve global-only `advisor.json` loading, default `true` gate initialization, and explicit `false` overrides across reloads and `Simple mode` toggles.
- Update `/advisor-settings` item descriptions in `src/ui/settings-items.ts` to accurately describe:
  - `Simple mode`: on-demand consultations only; turn `Off` to configure and inject Plan, Failure, Completion, and Custom gate instructions plus loop gates and budgets.
  - `Always on`: restores Advisor flow and configured Executor at session startup (does not force a consultation every turn).
  - `Plan gate`, `Failure gate`, `Completion gate`, `Custom invocation`: Executor system-prompt review instructions (cooperative, not hard tool blocks).
  - `Automatic loop gate`: deterministic interceptor when normalized tool calls repeat `Loop threshold` times.
- Verify the end-to-end `/advisor-settings` TUI roundtrip (with Phase 2 `SettingsListAdapter` public-method support and Phase 3 prompt builder) across `Simple mode` `On` ↔ `Off` and individual gate toggles.
- Provide an exact opt-in JSON merge example in `docs/configuration.md` showing how to enable full gate instructions in `~/.omp/agent/advisor.json` while keeping existing models, whitelist, Jev, and privacy fields intact.

### Non-Functional

- Read [Pi extension docs](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md) before modifying settings UI or hooks; keep `src/{config,ui,tools,commands}.ts` facades frozen (`test/facade-exports.test.ts`).
- Preserve all public and unrelated/unknown `advisor.json` fields when saving (`applyChangedConfigValues`) without normalizing or storing credentials in `advisor.json`; add tests covering defaults, validation, persistence, and UI navigation per fork `AGENTS.md`.
- Keep tool-action blocking (`block-tool`) and session blocking (`block-session`) distinct in settings and runtime behavior; no broad source cleanup or unrequested git commits.
- Never read, copy, or modify the operator's real `~/.omp/agent/advisor.json` or `~/.pi/agent/advisor.json` during tests; all verification uses isolated temporary `PI_CODING_AGENT_DIR` directories via `withAgentDir` (`test/helpers/config-fixture.ts`).

## Architecture

| Configuration Stage | Component / Boundary | Effective Behavior |
| --- | --- | --- |
| 1. Global Load | `loadConfig(ctx)` (`src/config/storage.ts`) | Reads only `join(getAgentDir(), "advisor.json")`; calls `resetDefaults()` (`advisorPlanGate`, `advisorFailureGate`, `advisorCompletionGate`, `advisorAutoLoopGate` = `true`; `simpleMode` = `false`), then applies disk overrides (`applyConfig`). |
| 2. Settings UI (`simpleMode: true`) | `AdvisorSettingsSelector` + `SettingsListAdapter` | Displays core rows while hiding advanced gate/loop/budget rows without erasing previously saved gate booleans in `advisor.json`. |
| 3. Settings UI (`simpleMode: false`) | `AdvisorSettingsSelector` + `saveAdvisorSettings` | Rebuilds list in place to expose `planGate`, `failureGate`, `completionGate`, `customRule`, `autoLoopGate`, `loopThreshold`, and `maxCallsPerSession`; merges only changed keys into `advisor.json` (`applyChangedConfigValues`). |
| 4. Turn Prompt Composition | `before_agent_start` (`src/tools/register-lifecycle.ts`) | Emits single voluntary guideline when `simpleMode: true`; when `simpleMode: false`, emits enabled Plan/Failure/Completion/Custom rules + remaining call budget inside the delimited `ADVISOR_PROMPT_BLOCK_START` / `ADVISOR_PROMPT_BLOCK_END` block. |

## Related Code Files

| File Path | Action | Responsibility |
| --- | --- | --- |
| `src/ui/settings-items.ts` | Modify | Refine descriptions for `simpleMode`, `alwaysOn`, `planGate`, `failureGate`, `completionGate`, `customRule`, and `autoLoopGate` to reflect startup activation vs cooperative prompt instructions vs deterministic loop interception. |
| `src/config/defaults.ts` | Read-only verify | Confirm `resetDefaults()` and `applyConfig()` preserve default `true` and explicit `false` for all gate booleans. |
| `src/config/storage.ts` | Read-only verify | Confirm global-only `getAgentDir()/advisor.json` path resolution and non-destructive key merge on save. |
| `src/commands/settings-persistence.ts` | Read-only verify | Confirm `saveAdvisorSettings` persists `simpleMode`, `planGate`, `failureGate`, `completionGate`, `customRule`, `autoLoopGate`, `loopThreshold`, and `maxCallsPerSession`. |
| `test/settings-selector.test.ts` | Modify | Add behavioral roundtrip tests with `withAgentDir` toggling `simpleMode` `On` → `Off` → `On`, toggling individual gate rows via Enter/Space and Left/Right arrow in both Pi and OMP `SettingsList` shapes, and verifying persisted `advisor.json` retains existing model/privacy/unknown keys. |
| `test/config-storage.test.ts` | Modify | Add explicit merge and reload tests with `withAgentDir` verifying `simpleMode: false` with selective `advisorPlanGate: false` / `advisorFailureGate: true` / `advisorCompletionGate: true` preserves untouched model, whitelist, Jev, privacy, and unrelated fields. |
| `docs/configuration.md` | Modify (in Phase 6 sync) | Document Simple mode vs full gate instructions, startup availability vs `alwaysOn`, the minimal 4-key full-gate JSON merge example, and the separate optional loop/budget tuning example. |

## Implementation Steps

1. **Refine Settings Row Descriptions (`src/ui/settings-items.ts`)**:
   - Update `simpleMode` description (`src/ui/settings-items.ts:353-355`): `"Keep the Advisor on demand only; turn off to enable Plan, Failure, Completion, and loop gates."`
   - Update `alwaysOn` description (`src/ui/settings-items.ts:361-363`): `"Restore the Advisor flow and configured Executor automatically at session startup."`
   - Update `planGate` (`L424`), `failureGate` (`L431`), `completionGate` (`L438`), and `customRule` (`L451`) descriptions so they clearly state they add Executor review instructions before committing to a consequential plan, after repeated failures, before declaring completion, or for a custom trigger.
   - Do not add tests that pin exact description prose or re-pin incidental menu item ordering; test observable selector visibility, toggle behavior, persistence, and prompt output.
2. **Verify Settings UI → Persistence → Prompt Roundtrip (`test/settings-selector.test.ts`, `test/config-storage.test.ts`)**:
   - Use `withAgentDir` and `savedConfig` from `test/helpers/config-fixture.ts` to seed an isolated `advisor.json` with configured models (e.g., Sol 6.1 / Opus 5.5 or placeholders) and unrelated fields:
     ```json
     {
       "executor": "google-antigravity/gemini-3.8-flash",
       "advisor": "openai-codex/gpt-6.1-sol",
       "advisorFallbackModel": "anthropic/claude-opus-5-5",
       "advisorModelWhitelist": ["google-antigravity/gemini-3.8-flash"],
       "simpleMode": true,
       "alwaysOn": true,
       "advisorGitContext": "summary",
       "advisorRedactSecrets": true,
       "advisorToolPolicies": { "bash": "summary" },
       "customOperatorNote": "preserve-unrelated-field"
     }
     ```
   - Instantiate `AdvisorSettingsSelector` (testing both Pi 1.x `SettingsList` and OMP `#private`-field `SettingsList` via Phase 2 `SettingsListAdapter`):
     1. Assert behaviorally that while `simpleMode` is `true`, advanced gate rows (`planGate`, `failureGate`, `completionGate`, `customRule`, `autoLoopGate`, `loopThreshold`, `maxCallsPerSession`) are absent from the active selector while `simpleMode` and `alwaysOn` remain accessible (without pinning incidental menu row order).
     2. Toggle `simpleMode` to `"Off"` using Left/Right arrow (`changeWithArrow`) and verify the rebuilt selector exposes `"planGate"`, `"failureGate"`, `"completionGate"`, `"customRule"`, `"autoLoopGate"`, `"loopThreshold"`, and `"maxCallsPerSession"`, with `planGate`, `failureGate`, and `completionGate` showing `"On"`.
     3. Toggle `failureGate` to `"Off"`, set `customRule` via `TextSettingSubmenu` to `"before schema migrations"`, and trigger `before_agent_start` with an OMP `{ systemPrompt: ["Base system prompt"] }` event:
        - Assert the returned `systemPrompt` contains the delimited `Advisor invocation settings:` block with the Plan gate rule, Completion gate rule, Custom rule (`"before schema migrations"`), and remaining call budget, and **omits** the Failure gate rule.
     4. Read back the persisted config via `savedConfig(agentDir)` and assert:
        - `"simpleMode": false`, `"advisorFailureGate": false`, `"advisorCustomInvocation": "before schema migrations"` are persisted.
        - `"executor"`, `"advisor"`, `"advisorFallbackModel"`, `"advisorModelWhitelist"`, `"advisorGitContext"`, `"advisorRedactSecrets"`, `"advisorToolPolicies"`, and `"customOperatorNote"` are preserved intact without normalizing or storing credentials in `advisor.json`.
     5. Toggle `simpleMode` back to `"On"`: assert `before_agent_start` emits only the single voluntary guideline without budget or gate rules, while `"advisorFailureGate": false` remains saved in `advisor.json` and reappears as `"Off"` when `simpleMode` is turned `"Off"` again.
   - **Focused Verification Command (run once by parent after Phase 05 edits; implementer skips gates)**: `bun test test/settings-selector.test.ts test/config-storage.test.ts`
3. **Document Minimal Opt-In JSON Merge & Separate Optional Loop/Budget Examples (`docs/configuration.md`)**:
   - Provide a **minimal full-gate JSON merge** example that sets **only** `simpleMode` and the three review gate flags so existing operator choices (models, whitelist, privacy, loop threshold, and session budget) are never overwritten:
     ```bash
     # Preview the merged JSON; this command does not save it:
     jq '. + {
       "simpleMode": false,
       "advisorPlanGate": true,
       "advisorFailureGate": true,
       "advisorCompletionGate": true
     }' ~/.omp/agent/advisor.json
     ```
   - Provide a **separate optional example** for operators who also want to customize deterministic loop gating or session call budget explicitly:
     ```bash
     # Optional preview only; does not change the saved loop threshold or budget:
     jq '. + {
       "advisorAutoLoopGate": true,
       "advisorLoopThreshold": 3,
       "advisorMaxCallsPerSession": 5
     }' ~/.omp/agent/advisor.json
     ```
   - These `jq` commands print previews only. Prefer `/advisor-settings` to persist changes; do not redirect `jq` output onto its input file. Retain existing model identifiers or use isolated loopback fixtures during verification; a documented identifier is not proof of host availability.
   - Document that `advisorPlanGate`, `advisorFailureGate`, and `advisorCompletionGate` already default to `true` when omitted, so setting `"simpleMode": false` activates all three unless any gate key was previously saved as `false`.

## Todo List

- [x] Update row descriptions in `src/ui/settings-items.ts` for `simpleMode`, `alwaysOn`, `planGate`, `failureGate`, `completionGate`, and `customRule`
- [x] Add behavioral `/advisor-settings` → `saveAdvisorSettings` → `before_agent_start` roundtrip tests using `withAgentDir` in `test/settings-selector.test.ts`
- [x] Add non-destructive JSON merge and explicit `false` persistence tests using `withAgentDir` in `test/config-storage.test.ts`
- [x] Prepare minimal full-gate JSON merge and separate optional loop/budget examples for `docs/configuration.md` (finalized with Phase 6 docs pass)

## Success Criteria

- Scenarios `T4` and `S1`–`S4` in [`./reports/acceptance-matrix.md`](./reports/acceptance-matrix.md) pass via `bun test test/settings-selector.test.ts test/config-storage.test.ts` with behavioral assertions (no menu-order or prose-string pinning).
- Zero new configuration keys or migrations introduced; `CONFIG_SCHEMA`, `SAVED_CONFIG_KEYS`, and frozen `src/*.ts` facades remain unchanged.
- Toggling `Simple mode` from `On` to `Off` in `/advisor-settings` (`T4`, `S1`, `S2`) immediately exposes `Plan gate`, `Failure gate`, `Completion gate`, and `Custom invocation` in both Pi and OMP hosts and persists `"simpleMode": false` without clobbering `executor`, `advisor`, `advisorFallbackModel`, `advisorModelWhitelist`, privacy settings, loop/budget settings, or unrelated `advisor.json` fields (`S4`).
- Explicit `false` on any individual gate (`advisorPlanGate`, `advisorFailureGate`, `advisorCompletionGate`) suppresses only that gate's instruction in `before_agent_start` and survives `Simple mode` `On` ↔ `Off` cycles and restarts (`S3`, `S4`).

## Risk Assessment

- **Risk**: Overly broad JSON merge examples in documentation could overwrite an operator's custom `advisorLoopThreshold` or `advisorMaxCallsPerSession`.
  - **Mitigation**: Keep the primary full-gate JSON merge strictly limited to `simpleMode`, `advisorPlanGate`, `advisorFailureGate`, and `advisorCompletionGate`, and show loop/budget tuning only as a separate optional snippet.
- **Risk**: Accidental edit to user's real `~/.omp/agent/advisor.json` during test execution.
  - **Mitigation**: Enforce `withAgentDir` (`test/helpers/config-fixture.ts`) on every settings and storage test.

## Security Considerations

- **Global-Only Enforcement**: Never load repo-local `advisor.json`; untrusted repositories must not be able to flip `simpleMode`, disable `advisorRedactSecrets`, or inject `advisorCustomInvocation` prompt text.
- **Unrelated Field Preservation Without Storing Credentials**: Saving gate toggles through `/advisor-settings` must preserve `advisorRedactSecrets`, `advisorToolPolicies`, `advisorModelWhitelist`, and unrelated fields in `advisor.json` without normalizing or writing credentials into `advisor.json`.

## Next Steps

- Proceed to [`./phase-06-integration-and-installation.md`](./phase-06-integration-and-installation.md) for bundle build, dual-host isolated verification, real OMP TUI & provider-boundary smoke, local plugin link/rollback workflow, and documentation/changelog finalization.

## Unresolved Questions

- None. Existing boolean keys and global-only persistence satisfy all gate configuration requirements.
