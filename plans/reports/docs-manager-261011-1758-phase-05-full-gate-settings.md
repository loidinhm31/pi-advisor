# Phase 05 Documentation Update Report: Full Gate Settings & Configuration Roundtrip

- **Plan**: `plans/261011-1403-omp-compatibility/plan.md`
- **Phase**: `plans/261011-1403-omp-compatibility/phase-05-full-gate-settings.md`
- **Date**: 2026-10-11
- **Agent**: Phase05DocsManager

## Deliverables Summary

Phase 05 refines `/advisor-settings` row descriptions, verifies dual-host settings/persistence/prompt roundtrip across Pi 1.x and Oh-My-Pi (OMP), and documents non-destructive full-gate configuration previews:

1. **Semantic Settings Row Descriptions (`src/ui/settings-items.ts`)**:
   - `simpleMode` (`L352-358`): Clarifies on-demand-only mode and turning `Off` to enable Plan, Failure, Completion, and loop gates.
   - `alwaysOn` (`L360-366`): Clarifies automatic restoration of the Advisor flow and configured Executor at session startup (rather than forcing a consultation every turn).
   - `planGate` (`L422-427`), `failureGate` (`L429-434`), `completionGate` (`L436-441`), and `customRule` (`L450-465`): Clarify that these rows add cooperative Executor system-prompt review instructions.
   - `autoLoopGate` (`L474-479`): Clarifies deterministic interception of repeated equivalent tool calls.

2. **Dual-Host Settings & Config Roundtrip Verification (`test/settings-selector.test.ts`, `test/config-storage.test.ts`)**:
   - Verified `T4` and `S1`–`S4` across both Pi 1.x and OMP `#private`-field `SettingsList` shapes via `SettingsListAdapter` and `runOmpScript` inside isolated `withAgentDir` fixtures.
   - Confirmed `simpleMode: true` hides advanced gate/loop/budget rows while retaining saved gate booleans (`advisorFailureGate: false`) across `On` ↔ `Off` cycles and cache reloads.
   - Confirmed `saveAdvisorSettings` and `applyChangedConfigValues` merge only modified keys into global `advisor.json`, preserving models, `advisorModelWhitelist`, Jev fields, privacy policies, and unknown keys (`customOperatorNote`), ignoring repo-local `<repo>/.pi/advisor.json`, and writing zero credentials.
   - Confirmed `CONFIG_SCHEMA` (49 keys) and `SAVED_CONFIG_KEYS` (48 persisted keys) remain unchanged with zero new config keys or migrations.

3. **Configuration Guide (`docs/configuration.md`)**:
   - Verified `## Simple mode and persistent activation` (`L84-120`, 223 total LOC < 800 LOC limit):
     - Documents default-`true` behavior for `advisorPlanGate`, `advisorFailureGate`, and `advisorCompletionGate` when `simpleMode` is turned `Off`, contrasting cooperative system-prompt rules with deterministic `advisorAutoLoopGate` `tool_call` interception.
     - Distinguishes extension tool availability from `alwaysOn` session-startup restoration.
     - Provides the minimal 4-key `jq` preview (`simpleMode`, `advisorPlanGate`, `advisorFailureGate`, `advisorCompletionGate`) for `~/.omp/agent/advisor.json` that preserves existing models, whitelist, Jev, privacy, loop threshold, and session budget.
     - Provides the separate optional 3-key `jq` preview (`advisorAutoLoopGate`, `advisorLoopThreshold`, `advisorMaxCallsPerSession`) and preview-only safety guidance.
   - `docs/codebase-summary.md` and `docs/system-architecture.md` are not present in this repository's curated `docs/` structure and were intentionally not created per YAGNI.

## Validation

- **File Size Check**: `docs/configuration.md` is 223 lines (< 800 LOC limit).
- **Code & Config Reference Accuracy**: Verified all documented config keys (`simpleMode`, `alwaysOn`, `advisorPlanGate`, `advisorFailureGate`, `advisorCompletionGate`, `advisorCustomInvocation`, `advisorAutoLoopGate`, `advisorLoopThreshold`, `advisorMaxCallsPerSession`) and UI item IDs against `src/config/schema.ts` and `src/ui/settings-items.ts`.
- **Operator Config Safety**: `~/.omp/agent/advisor.json` and `~/.pi/agent/advisor.json` were never read or modified.
- **Checks**: Mid-flight build/lint/test checks skipped per contract; parent runs final verification before commit.

## Unresolved Questions

None.
