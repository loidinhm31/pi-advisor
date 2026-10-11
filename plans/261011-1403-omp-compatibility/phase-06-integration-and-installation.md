# Phase 06: Integration, Dual-Host Verification, Installation & Docs

## Context Links

- Plan Overview: [`./plan.md`](./plan.md)
- Acceptance Matrix: [`./reports/acceptance-matrix.md`](./reports/acceptance-matrix.md) (Scenarios `H1`, `T3`, `R1`–`R3`, plus full suite `T1`–`S4`)
- Fork Rules: [`../../AGENTS.md`](../../AGENTS.md) & [Pi Extension Docs](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)
- Planning Brief: [`./research/planning-brief.md`](./research/planning-brief.md)
- Design Decisions: [`./research/design-decisions.md`](./research/design-decisions.md)
- TUI & Packaging Research: [`./research/tui-packaging-research.md`](./research/tui-packaging-research.md)
- Prompt & Settings Research: [`./research/prompt-settings-research.md`](./research/prompt-settings-research.md)
- Prerequisite Phases: [`./phase-01-host-contracts.md`](./phase-01-host-contracts.md), [`./phase-02-tui-compatibility.md`](./phase-02-tui-compatibility.md), [`./phase-03-prompt-injection.md`](./phase-03-prompt-injection.md), [`./phase-04-device-lifecycle-safety.md`](./phase-04-device-lifecycle-safety.md), [`./phase-05-full-gate-settings.md`](./phase-05-full-gate-settings.md)

## Overview

- **Date**: 2026-10-11
- **Priority**: P0 (Final integration, package manifest gate, real OMP smoke, safe local linking, and docs)
- **Implementation Status**: pending (0%)
- **Review Status**: pending
- **Owner**: `integration` (single integration owner for shared manifest/scripts, build, verification, and docs; fork baseline `df0fc3f17bfab7d52e3f64704015e0493dfd9e01` v0.13.0, OMP baseline `c9de2b02b997f37cc89639282ed35dec86f139e8` with symbol-level verification due to OMP working-tree drift)

## Key Insights

1. **Bundle-First Execution (`dist/index.js`) & Manifest Timing**:
   - Both Pi (`package.json#main` / `test:node-loader`) and OMP (`package.json#pi.extensions: ["./dist/index.js"]`) load the compiled bundle `dist/index.js`, **not** `src/**`.
   - Static prompt assets introduced in Phase 03 (`src/tools/prompt-assets.d.ts`, `src/tools/prompts/{simple-mode,plan-gate,failure-gate,completion-gate,invocation-routing}.md`) and `--loader .md:text` in `package.json#scripts.build` are registered in `scripts/check-package.mjs` `expectedFiles` **at introduction by the single integration owner** so Phase 03 builds and checks are never delayed until Phase 06.
   - A running OMP/Pi process requires a **fresh OS process** after `bun run build` (in-process `/reload` can serve cached ESM modules).
2. **Temporary Isolation Requires Disposable `HOME` + Cleared XDG/Profile Env + `PI_CODING_AGENT_DIR`**:
   - In OMP (`@oh-my-pi/pi-utils/dirs.ts`), `PI_CODING_AGENT_DIR` isolates agent data (`~/.omp/agent`), **not** `HOME` plugins (`getPluginsDir()` resolves `~/.omp/plugins` or XDG data dirs).
   - Isolated OMP smoke/link verification must therefore run under a permission-restricted disposable `HOME` with `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME`, `OMP_PROFILE`, and `PI_PROFILE` unset, plus `PI_CODING_AGENT_DIR="$HOME/.omp/agent"`, verifying resolved roots before linking or launching, and passing `--no-extensions -e /home/loidinh/WS/pi-advisor/dist/index.js --no-skills` when testing explicit extension loading so no auto-discovered user extensions load.
3. **Destructive Local Plugin Link, Whole-State Backup & Verified Install/Rollback Syntax**:
   - `omp plugin link /home/loidinh/WS/pi-advisor` (or `omp plugin install /home/loidinh/WS/pi-advisor` / `omp install /home/loidinh/WS/pi-advisor`) replaces `~/.omp/plugins/node_modules/pi-advisor-flow` with a symlink and mutates `~/.omp/plugins/package.json`, `omp-plugins.lock.json`, and `bun.lock`/`bun.lockb`.
   - Before linking into a live operator environment, back up the whole relevant `~/.omp/plugins` state (`package.json`, `omp-plugins.lock.json`, `bun.lock`/`bun.lockb`, and `node_modules/pi-advisor-flow` entry/target) plus `~/.omp/agent/advisor.json` inside a `0700` permission-restricted directory (`mktemp -d` under `umask 077`), never copying secrets to predictable world-readable `/tmp` filenames.
   - For rollback to the published release, plain `omp plugin install pi-advisor-flow@0.13.0` is preferred (validate syntax via `omp plugin --help` at implementation time; do **not** claim `npm:pi-advisor-flow@0.13.0` is verified because OMP's `NPM_SPEC_RE` rejects the `npm:` prefix).
   - Remote git install syntax is `omp plugin install github:loidinhm31/pi-advisor#<ref>` or `https://github.com/loidinhm31/pi-advisor#<ref>` (`git:` is rejected by OMP's `SHORTHAND_PREFIXES`, and local `./*.tgz` paths are misclassified as directory links by `isLocalPathSpec`).

## Requirements

### Functional

- Verify manifest/build wiring already includes Phase 01/03 assets; run `bun run package:check` once before smoke. Its `npm pack --dry-run` invokes `prepack`, building `dist/index.js`; use that artifact for all remaining checks without an extra manual build.
- Execute dual-host verification in **isolated OS processes** (Pi 1.x process vs OMP process with disposable `HOME`, cleared XDG/profile env, and temp `PI_CODING_AGENT_DIR`; never mutate module graphs in-process via `mock.module`).
- Capture real OMP TUI overlay interaction evidence (`/advisor-manual` and `/advisor-settings`) and deterministic loopback provider-boundary request evidence showing delimited `Advisor invocation settings:` injection (`ADVISOR_PROMPT_BLOCK_START` / `ADVISOR_PROMPT_BLOCK_END`), `xd://ask_advisor` routing, and gate toggles.
- Make **no paid live model calls** unless explicitly authorized by the user during implementation: deterministic gates are mandatory; if live calls (`R3`) are not authorized, mark `R3` as **not run** and state the limitation (never report deterministic fake-provider captures as real model responses).
- Update `README.md`, `docs/configuration.md`, `docs/development.md`, and `CHANGELOG.md` (`## Unreleased`), then run the final repository quality gates once without redundant rebuilds.

### Non-Functional

- Visually review and compare rendered call box, streaming state, final response, error treatment, and blocked state (keeping tool-action blocking vs session blocking distinct, and session summaries local/ephemeral) in the reloaded TUI against existing Advisor UI per fork `AGENTS.md`.
- Preserve frozen `src/{config,ui,tools,commands}.ts` facades (`test/facade-exports.test.ts`), `"name": "pi-advisor-flow"`, and `"version": "0.13.0"` in `package.json`; do not perform broad source cleanup or create git commits, tags, or npm publications unless explicitly instructed by the user.
- Document only delivered user-facing behavior in `README.md` and `CHANGELOG.md`, and keep `/home/loidinh/WS/oh-my-pi` completely untouched.

## Architecture

| Integration Stage | Execution Boundary | Required Verification & Output |
| --- | --- | --- |
| 1. Package Check & Build | `/home/loidinh/WS/pi-advisor` | Verify asset manifest, run `bun run package:check` (includes prepack build), retain built artifact identity for subsequent smoke. |
| 2. Isolated OMP Host Smoke (Process C) | Disposable `0700` `HOME` + cleared `XDG_*`/`OMP_PROFILE`/`PI_PROFILE` + temp `PI_CODING_AGENT_DIR` | Verify resolved roots (`omp config path` and `$HOME/.omp/plugins`) before link/launch; launch with `--no-extensions -e /home/loidinh/WS/pi-advisor/dist/index.js --no-skills` (or isolated `omp plugin link`); capture TUI overlays and deterministic loopback provider requests. |
| 3. Docs & Final Gate Pass | `README.md`, `docs/*.md`, `CHANGELOG.md` + Pi 1.x / static gates | After smoke, update docs/changelog; run unit, Node-loader, type, boundary, lint, and format checks once. Package check already ran; repeat only if package inputs changed. |
| 4. Optional Live Link & Rollback | Operator `~/.omp/plugins` & `~/.omp/agent/advisor.json` | Back up whole plugin state + config into `0700` temp dir (`umask 077`); `omp plugin link /home/loidinh/WS/pi-advisor`; rollback via `omp plugin uninstall pi-advisor-flow && omp plugin install pi-advisor-flow@0.13.0` + backup restore. |

## Related Code Files

| File Path | Action | Responsibility |
| --- | --- | --- |
| `package.json` | Verify / Modify (if needed) | Keep `"name": "pi-advisor-flow"`; confirm `--loader .md:text` in `scripts.build` (added in Phase 01). |
| `scripts/check-package.mjs` | Verify / Modify (if needed) | Confirm `expectedFiles` sorted list already registers Phase 03 static prompt assets (`src/tools/prompt-assets.d.ts`, `src/tools/prompts/*.md`) at introduction. |
| `src/tools/prompt-assets.d.ts` | CREATE (in Phase 03, verified here) | TypeScript ambient module declaration for `*.md` text imports. |
| `src/tools/prompts/simple-mode.md` | CREATE (in Phase 03, verified here) | Static prompt asset for Simple mode rule. |
| `src/tools/prompts/plan-gate.md` | CREATE (in Phase 03, verified here) | Static prompt asset for Plan gate instruction. |
| `src/tools/prompts/failure-gate.md` | CREATE (in Phase 03, verified here) | Static prompt asset for Failure gate instruction. |
| `src/tools/prompts/completion-gate.md` | CREATE (in Phase 03, verified here) | Static prompt asset for Completion gate instruction. |
| `src/tools/prompts/invocation-routing.md` | CREATE (in Phase 03, verified here) | Static prompt asset for conditional `xd://ask_advisor` vs direct `ask_advisor` routing. |
| `test/helpers/dual-host-harness.ts` | CREATE (in Phase 01, verified here) | Dual-host test harness builders for Pi 1.x and OMP contracts. |
| `test/host-contracts.test.ts` | CREATE (in Phase 01, verified here) | Host capability and contract boundary tests. |
| `dist/index.js` | Generate (`prepack` build) | Compiled ESM bundle loaded by both hosts; may be absent before the first build. |
| `README.md` | Modify | Document OMP support, `xd://ask_advisor` transport, `Simple mode` vs full gates, and valid `omp plugin link` / `github:loidinhm31/pi-advisor#<ref>` / `pi-advisor-flow@0.13.0` syntax. |
| `docs/configuration.md` | Modify | Document `~/.omp/agent/advisor.json`, `alwaysOn` startup flow restoration vs per-turn consultation, cooperative prompt gates vs loop gate, and the Phase 05 minimal 4-key JSON merge + separate optional loop/budget snippets. |
| `docs/development.md` | Modify | Document `bun run build` before OMP reload, fresh-process restart requirement, and isolated dual-host verification commands. |
| `CHANGELOG.md` | Modify | Record OMP TUI compatibility, `before_agent_start` `string[]` + `xd://ask_advisor` prompt injection, `xd://` lifecycle/Scout privacy fixes, `agent_end` settlement, and subagent isolation under `## Unreleased`. |

## Implementation Steps

1. **Confirm Package Manifest Assets & Build Bundle Once (`package.json`, `scripts/check-package.mjs`, `dist/index.js`)**:
   - Confirm that the integration owner already registered Phase 03's static prompt assets (`src/tools/prompt-assets.d.ts`, `src/tools/prompts/{completion-gate,failure-gate,invocation-routing,plan-gate,simple-mode}.md`) in `scripts/check-package.mjs` `expectedFiles` and `--loader .md:text` in `package.json#scripts.build` at introduction.
   - Run `bun run package:check` once in `/home/loidinh/WS/pi-advisor`; `scripts/check-package.mjs` invokes `npm pack --dry-run --json`, whose `prepack` builds `dist/index.js`. Do not also run a redundant manual build.
2. **Run Isolated OMP Host TUI & Deterministic Provider-Boundary Verification (Process C)**:
   - Create a permission-restricted disposable environment so neither `~/.omp/agent` nor `~/.omp/plugins` in the user's real `HOME` can be read or mutated:
     ```bash
     umask 077
     ISO_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/omp-advisor-iso.XXXXXX")"
     chmod 700 "$ISO_ROOT"
     mkdir -p "$ISO_ROOT/home/.omp/agent"
     # Verify resolved agent root and CLI flags before starting or linking:
     env -u XDG_CONFIG_HOME -u XDG_DATA_HOME -u XDG_STATE_HOME -u XDG_CACHE_HOME \
         -u OMP_PROFILE -u PI_PROFILE \
         HOME="$ISO_ROOT/home" PI_CODING_AGENT_DIR="$ISO_ROOT/home/.omp/agent" \
         omp config path
     ```
   - **Explicit Extension Bundle Smoke (`--no-extensions -e`) & Isolated Plugin Link Check**:
     1. Launch OMP in a headless PTY (`xd://tui` or isolated PTY child process) under the isolated env above with `--no-extensions -e /home/loidinh/WS/pi-advisor/dist/index.js --no-skills` (confirming no auto-discovered user extensions load). Also verify isolated `omp plugin link /home/loidinh/WS/pi-advisor` + `omp plugin list --json` resolves `$ISO_ROOT/home/.omp/plugins/node_modules/pi-advisor-flow/dist/index.js` (`R2`).
     2. **TUI `/advisor-manual` & Visual Renderer Smoke (`T1`–`T3`, `R1`)**: Run `/advisor-manual draft focus`, verify the dialog renders with single `"pi"` horizontal rules (`paddingX = 0`), accepts text input and Up/Down/Tab navigation without `Editor` or `symbols.boxRound` errors, and exits cleanly on Escape. Visually verify call box, streaming update, rendered response, fallback/error treatment, and tool-vs-session blocked states against existing Advisor UI.
     3. **TUI `/advisor-settings` Smoke (`T4`, `T5`, `S1`–`S4`)**: Run `/advisor-settings`, toggle `Simple mode` from `On` to `Off` using arrow keys/Space, verify `Plan gate`, `Failure gate`, `Completion gate`, and `Custom invocation` appear immediately, open a masked-input or text submenu to verify cursor rendering (no `NaN` repeat error), and close with Escape.
     4. **Deterministic Provider-Boundary Capture (`P1`–`P4`, `D1`–`D6`, `R1`)**: Register fixture Executor/Advisor models through the host's supported provider/model configuration or SDK, with base URLs pointing only to a loopback HTTP server (`127.0.0.1`). Put those registered model references in isolated `advisor.json`, with `"simpleMode": false` and all three review flags true. `advisor.json` selects models; it does not define provider endpoints. Clear inherited provider credentials and disable unrelated integrations.
        - Trigger a turn and verify the captured outbound `systemPrompt` preserves all base OMP blocks in order and appends exactly one delimited `Advisor invocation settings:` block (`ADVISOR_PROMPT_BLOCK_START` .. `ADVISOR_PROMPT_BLOCK_END`) with conditional `xd://ask_advisor` routing.
        - Dispatch a registered `write` to `xd://ask_advisor` and verify it produces one canonical Advisor consultation, renders via the standard Advisor renderer, and respects primary-to-fallback retry (`R1`) and cancellation (`T3`). Preserve captured loopback payloads as deterministic evidence — never report them as real model responses.
        - Run `/advisor-off` and trigger a second turn: verify only the delimited `Advisor invocation settings:` block is removed.
     5. **Optional Authorized Live Call (`R3`)**: Only if explicitly authorized by the user, run non-trivial plan / repeated-failure / completion scenarios against a live model and record actual provider/model identity and call order. When not authorized, record `R3` as **not run (live paid call not authorized)** and state that cooperative prompt compliance remains model-dependent.
3. **Update Documentation & Changelog, Then Run Final Repository Gates Once (`README.md`, `docs/*.md`, `CHANGELOG.md`)**:
   - Update `README.md`, `docs/configuration.md` (including the minimal 4-key JSON merge and separate optional loop/budget snippet from Phase 05), `docs/development.md`, and `CHANGELOG.md` (`## Unreleased`).
   - Run the remaining repository gates once after smoke and documentation edits. Package check/build already ran in Step 1; rerun it only if packaged files changed (for example README/changelog updates), noting the lifecycle-triggered rebuild rather than claiming a single build across changed inputs:
     ```bash
     bun test && bun run test:node-loader && bun run typecheck && bun run check:boundaries && bun run lint && bun run format:check
     ```
4. **Deliberate Live Operator OMP Plugin Link & Rollback Procedure (Only When Requested)**:
   - Validate CLI subcommands first (`omp plugin --help`), then back up the whole relevant plugin state and config into a `0700` directory:
     ```bash
     umask 077
     BACKUP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/omp-advisor-backup.XXXXXX")"
     chmod 700 "$BACKUP_DIR"
     mkdir -p "$BACKUP_DIR/plugins" "$BACKUP_DIR/agent"
     for f in package.json omp-plugins.lock.json bun.lock bun.lockb; do
       [ -e "$HOME/.omp/plugins/$f" ] && cp -a "$HOME/.omp/plugins/$f" "$BACKUP_DIR/plugins/"
     done
     [ -e "$HOME/.omp/plugins/node_modules/pi-advisor-flow" ] && \
       cp -a "$HOME/.omp/plugins/node_modules/pi-advisor-flow" "$BACKUP_DIR/plugins/pi-advisor-flow.entry"
     [ -e "$HOME/.omp/agent/advisor.json" ] && \
       cp -a "$HOME/.omp/agent/advisor.json" "$BACKUP_DIR/agent/advisor.json"

     # Link built fork and verify target in a fresh process:
     omp plugin link /home/loidinh/WS/pi-advisor
     realpath "$HOME/.omp/plugins/node_modules/pi-advisor-flow/dist/index.js"
     ```
   - **Rollback Command Sequence** (validate syntax with `omp plugin --help`; prefer plain `pi-advisor-flow@0.13.0` and do **not** use unverified `npm:` prefix):
     ```bash
     omp plugin uninstall pi-advisor-flow
     omp plugin install pi-advisor-flow@0.13.0
     # Exact-state restore is an alternative to npm reinstall, not this copy command:
     # Restore each backed-up manifest/lock to its original path and the saved entry
     # to node_modules/pi-advisor-flow, removing the replacement link first.
     ```
   - The backup stores the package entry as `plugins/pi-advisor-flow.entry`; never copy that directory wholesale into the plugins root as a restore. Preserve the original symlink target if present, do not modify that target during verification, and restore `advisor.json` only if this operation changed it. Record original absent files too, so an exact restore can remove newly created lockfiles after approval.
   - **Remote Git Install Command** (for pushed fork branches/commits containing built `dist/index.js`): `omp plugin install github:loidinhm31/pi-advisor#<branch-or-sha>`

## Todo List

- [ ] Confirm Phase 01/03 created assets are registered in `scripts/check-package.mjs` and `package.json#scripts.build`, and build `dist/index.js`
- [ ] Execute isolated OMP host smoke (`HOME` + cleared XDG/profile env + `PI_CODING_AGENT_DIR` + `--no-extensions -e`) for TUI overlays and deterministic loopback provider capture
- [ ] Update `README.md`, `docs/configuration.md`, `docs/development.md`, and `CHANGELOG.md` (`## Unreleased`)
- [ ] Run all final repository gates once (`bun test`, `test:node-loader`, `typecheck`, `check:boundaries`, `lint`, `format:check`, `package:check`)
- [ ] Perform `0700`-backed-up `omp plugin link /home/loidinh/WS/pi-advisor` and fresh-process verification only if requested during implementation

## Success Criteria

- All mandatory repository gate scripts and deterministic acceptance scenarios (`H1`, `T1`–`T5`, `P1`–`P4`, `D1`–`D6`, `S1`–`S4`, `R1`, `R2`) pass with zero errors; optional live scenario `R3` is either executed with explicit user authorization or explicitly recorded as **not run** with its model-compliance limitation stated.
- Isolated Pi 1.x and OMP processes (with verified disposable `HOME` and temp `PI_CODING_AGENT_DIR`) load fresh `dist/index.js` (`R2`), visually match Advisor call/stream/result/error/blocked TUI states, and deliver accurate delimited `Advisor invocation settings:` blocks at the deterministic provider boundary.
- Documentation and `CHANGELOG.md` accurately reflect delivered user-facing OMP install/rollback syntax (`omp plugin link`, `omp plugin install pi-advisor-flow@0.13.0`, `omp plugin install github:loidinhm31/pi-advisor#<ref>`), `xd://ask_advisor` transport, and `Simple mode` vs full gate settings.

## Risk Assessment

- **Risk**: Setting only `PI_CODING_AGENT_DIR` during OMP smoke tests leaks into or mutates the operator's real `~/.omp/plugins`.
  - **Mitigation**: Always isolate `HOME`, unset `XDG_*` and `OMP_PROFILE`/`PI_PROFILE`, verify resolved paths before linking/starting, and pass `--no-extensions -e .../dist/index.js --no-skills` for explicit bundle runs.
- **Risk**: Backing up `advisor.json` or plugin state to predictable `/tmp` filenames exposes sensitive configuration or leaves partial plugin lock state on rollback.
  - **Mitigation**: Create a `0700` backup directory (`umask 077`, `mktemp -d`) and back up `package.json`, `omp-plugins.lock.json`, `bun.lock`/`bun.lockb`, `node_modules/pi-advisor-flow`, and `advisor.json`.

## Security Considerations

- **No Unauthorized Egress**: Mandatory provider-boundary verification uses a local loopback server (`127.0.0.1`) and temporary fixtures; no real API keys or paid provider endpoints are contacted unless `R3` is explicitly authorized.
- **Permission-Restricted Backups & No Unintended Publication**: Backups use mode `0700`; do not run `npm publish`, `git commit`, `git tag`, or `git push` unless explicitly requested.

## Next Steps

- Present deterministic verification evidence, `R3` authorization/not-run status, and `0700` backup/rollback instructions to the user upon implementation completion.

## Unresolved Questions

- None.
