# Code Review Report: Phase 05 — Full Gate Settings & Configuration Roundtrip

- **Date**: 2026-10-11
- **Phase**: [`plans/261011-1403-omp-compatibility/phase-05-full-gate-settings.md`](../261011-1403-omp-compatibility/phase-05-full-gate-settings.md)
- **QA Reference**: [`plans/reports/qa-261011-1748-phase-05-full-gate-settings.md`](./qa-261011-1748-phase-05-full-gate-settings.md)
- **Score**: 10/10
- **Verdict**: PASS (0 critical issues, 0 warnings)

## Scope

- **Files Reviewed**:
  - `src/ui/settings-items.ts` (653 LOC)
  - `test/settings-selector.test.ts` (761 LOC)
  - `test/config-storage.test.ts` (577 LOC)
  - `docs/configuration.md` (223 LOC)
  - `plans/reports/qa-261011-1748-phase-05-full-gate-settings.md` (44 LOC)
  - Read-only contract & facade verification: `src/{config,ui,tools,commands}.ts`, `src/config/{defaults,storage,schema}.ts`, `src/commands/settings-persistence.ts`

## Overall Assessment

Phase 05 cleanly fulfills all functional, security, and architectural requirements without introducing new configuration schema keys, migrations, or facade changes. UI row descriptions accurately distinguish session-startup restoration (`Always on`), cooperative Executor system-prompt review rules (`Plan gate`, `Failure gate`, `Completion gate`, `Custom invocation`), on-demand suppression (`Simple mode`), and deterministic `tool_call` interception (`Automatic loop gate`). Dual-host roundtrip tests verify `T4` and `S1`–`S4` end-to-end across both Pi 1.x and OMP `#private`-field `SettingsList` shapes inside isolated `withAgentDir` fixtures.

## Critical Issues

- None.

## Warnings

- None.

## Suggestions (Low Priority)

1. **Consistent selector disposal in `test/settings-selector.test.ts` (`L427-521`)**: `stepPhase === 2` and `stepPhase === 3` call `created.dispose()` inside the `ui.custom` callback, whereas `stepPhase === 1` disposes via `activeSelector?.dispose()` after `handler()` resolves (`L521`). Calling `created.dispose()` before `resolve(undefined)` for all phases would make cleanup uniform without needing `activeSelector`.
2. **Plan status sync (`plans/261011-1403-omp-compatibility/phase-05-full-gate-settings.md`)**: Main agent should flip `Implementation Status` / `Review Status` and check off `L133-136` todo items when updating plan progress (kept untouched here per read-only review contract).

## Architecture, Security, Performance & YAGNI/KISS/DRY Audit

- **Zero New Config Keys**: `CONFIG_SCHEMA` remains pinned at 49 keys and `SAVED_CONFIG_KEYS` at 48 persisted keys (`test/config-storage.test.ts:464-577`).
- **Frozen Facades**: `src/config.ts`, `src/ui.ts`, `src/tools.ts`, and `src/commands.ts` remain untouched; `test/facade-exports.test.ts` and `scripts/check-module-boundaries.mjs` pass.
- **Security**:
  - `loadConfig` (`src/config/storage.ts:166-201`) loads only global `join(getAgentDir(), "advisor.json")`. Adversarial repo-local `<repo>/.pi/advisor.json` is ignored even when `isProjectTrusted() === true` (`test/config-storage.test.ts:282-318`).
  - `applyChangedConfigValues` preserves `advisorRedactSecrets`, `advisorToolPolicies`, `advisorModelWhitelist`, Jev fields, and unknown keys (`customOperatorNote`) while never writing `apiKey`, `jevApiKey`, or `openaiApiKey` (`test/settings-selector.test.ts:550-568`, `test/config-storage.test.ts:372-399`).
  - Real `~/.omp/agent/advisor.json` and `~/.pi/agent/advisor.json` were never read or modified; all tests use `withAgentDir` temporary directories.
- **Performance**: Nanosecond stat-identity config caching (`src/config/storage.ts:146-164`) avoids redundant JSON parsing on hot paths while invalidating on `saveConfig`.
- **YAGNI / KISS / DRY**: Reuses existing boolean/number/string config keys; tests assert observable row reachability, toggle state, persisted JSON, and `before_agent_start` output without pinning menu ordering or description prose.

## Scenario Verification (`T4`, `S1`–`S4`)

| Scenario | Status | Evidence                                                                                                                                                                                                                                                                                                                                                                    |
| -------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **T4**   | PASS   | `test/settings-selector.test.ts:364-760`: `/advisor-settings` hides advanced gate/loop/budget rows when `simpleMode: true`, rebuilds in place via `SettingsListAdapter` on Right/Left arrow toggle across Pi 1.x and OMP `#private`-field `SettingsList`, toggles `Failure gate` and `Max Advisor calls/session`, and updates `Custom invocation` via `TextSettingSubmenu`. |
| **S1**   | PASS   | `test/settings-selector.test.ts:574-598, 708-753` & `test/config-storage.test.ts:304-317`: `simpleMode: true` with gate flags `true` emits only the single voluntary second-opinion guideline without gate rules or session call budget.                                                                                                                                    |
| **S2**   | PASS   | `test/settings-selector.test.ts:523-547, 701-747` & `test/config-storage.test.ts:319-352`: `simpleMode: false` activates default-`true` gate flags and injects the delimited `<!-- pi-advisor-flow:invocation-settings:start -->` block with enabled Plan/Failure/Completion/Custom rules and remaining call budget.                                                        |
| **S3**   | PASS   | `test/settings-selector.test.ts:471-602, 673-759` & `test/config-storage.test.ts:319-370`: Individual `false` gate overrides (`failureGate: false`, `planGate: false`, and all three `false`) suppress only disabled gate instructions, retain `customRule`, and survive `Simple mode` `On` ↔ `Off` cycles and cache reloads.                                               |
| **S4**   | PASS   | `test/config-storage.test.ts:261-404`, `test/settings-selector.test.ts:550-568`, `docs/configuration.md:84-121`: Non-destructive merge preserves models, whitelist, Jev, privacy, and unknown keys; ignores repo-local `advisor.json`; persists zero credentials; docs provide separate minimal 4-key full-gate and optional 3-key loop/budget `jq` preview snippets.       |

## Validation Commands & Results (from QA Report `qa-261011-1748-phase-05-full-gate-settings.md`)

- `bun test test/settings-selector.test.ts test/config-storage.test.ts`: **PASS** (28 pass, 0 fail, 134 `expect()`, 3.07s)
- `bun test test/facade-exports.test.ts && node scripts/check-module-boundaries.mjs`: **PASS** (9 pass, 0 fail, 47 `expect()`, 0.66s)
- `bun test`: **PASS** (588 pass, 0 fail, 5,590 `expect()` across 62 files, 15.82s)
- `bun run test:node-loader`: **PASS** (1 pass, 0.72s)
- `bun x tsc --noEmit && bun run lint && bun run format:check`: **PASS** (0 TS errors, 0 `oxlint` warnings, 433 files formatted, 2.42s)

## Unresolved Questions

- None.
