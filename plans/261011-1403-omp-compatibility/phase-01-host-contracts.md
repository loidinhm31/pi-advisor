# Phase 01: Host Contracts, Capability Boundaries & Test Harness

## Context Links

- [Overview Plan](plan.md)
- [Planning Brief](research/planning-brief.md)
- [Design Decisions & Phase Contracts](research/design-decisions.md)
- [TUI & Packaging Research](research/tui-packaging-research.md)
- [Prompt, Settings & Lifecycle Research](research/prompt-settings-research.md)
- [Requirement and Verification Matrix](reports/acceptance-matrix.md) (`H1`)
- [Pi Extension Docs](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)
- [Phase 02 — TUI Compatibility](phase-02-tui-compatibility.md)
- [Phase 03 — Prompt Injection](phase-03-prompt-injection.md)

## Overview

- **Date**: 2026-10-11
- **Priority**: P2
- **Implementation Status**: DONE (100% — 2026-10-11)
- **Review Status**: Approved (10/10 — 2026-10-11)
- **Owner**: Integration owner
- **Depends On**: None (prerequisite for Phases 02, 03, and 04)
- **Scope**: Freeze narrow structural capability contracts for TUI components (`Editor`, `SettingsList`, `Input`), delimited `before_agent_start` prompt ownership, static `.md` instruction asset bundling, host-specific settlement/agent-identity contracts, and an executable dual-host subprocess test harness.

## Key Insights

- Baseline: `/home/loidinh/WS/pi-advisor` `df0fc3f17bfab7d52e3f64704015e0493dfd9e01` (v0.13.0); reference `/home/loidinh/WS/oh-my-pi` initial `c9de2b02b997f37cc89639282ed35dec86f139e8` (OMP working tree drifted during research; cite symbols first, re-verify lines at implementation kickoff). `EVCRATE_SESSION_ID` was absent during helper run; pass `/home/loidinh/WS/pi-advisor/plans/261011-1403-omp-compatibility` explicitly.
- OMP rewrites `@earendil-works/pi-*` imports to `@oh-my-pi/*` shims (`PI_SCOPE_ALIASES` / `PI_PACKAGE_NAMES` in `legacy-pi-compat.ts`) and loads `./dist/index.js` from `package.json#pi.extensions`. Source edits in `src/**` have no effect in OMP or `test:node-loader` until `bun run build` runs.
- OMP's `legacy-pi-tui-shim.ts` re-exports `@oh-my-pi/pi-tui` directly without wrapping `Editor` (`1`-arg constructor requiring complete `SymbolTheme` on `theme.symbols` and `theme.selectList.symbols`), `SettingsList` (ES `#private` state + public methods), or `Input` (ES `#cursor` + public `getCursor()`).
- In OMP, `BeforeAgentStartEvent` (`emitBeforeAgentStart` in `runner.ts`, `#prepareAgentStart` in `agent-session.ts`) passes `{ prompt, images, systemPrompt: string[] }` without `systemPromptOptions.sections`, and discoverable tools mount under `xd://ask_advisor` while remaining in `pi.getActiveTools()`.
- OMP emits `agent_end` (`{ type: "agent_end", messages, willContinue?: boolean }`) and provides a structural `ctx.agent` (`ExtensionAgentIdentity` with `kind: "main" | "sub"` and string `id`), whereas Pi 1.x omits `ctx.agent` and settles on `agent_settled`.
- Global host singletons (`isOmpHost()`), `Editor.length` arity checks, unexported `getSymbolTheme` imports, prose substring parsing, and mock-double self-tests are forbidden by design decisions. Runtime capability checks are future implementation gates, not completed proofs.

## Requirements

### Functional Requirements

1. Freeze narrow, feature-detected structural contracts for Phase 02 (TUI), Phase 03 (Prompt Injection), and Phase 04 (Settlement & Subagent Identity) with zero global host singleton.
2. Preserve Pi 1.x (`@earendil-works/pi-*@^1.0.0`) compatibility and frozen public facade exports (`src/{config,ui,tools,commands}.ts`); keep internal capability symbols private to leaf modules unless genuinely consumed by another leaf.
3. Deliver an executable dual-host test harness (`test/helpers/dual-host-harness.ts`) and boundary test suite (`test/host-contracts.test.ts`) that load built `dist/index.js` in isolated Pi 1.x and OMP subprocesses against real host components and loaders. Keep `test/helpers/harness.ts` and `test/helpers/mock-pi.ts` strictly as bounded fixture seams for unit wiring, never as proof of host compatibility.
4. Define the static `.md` prompt asset build/manifest contract so Phase 03 bundles Markdown instruction templates via static text imports with zero runtime filesystem reads.
5. Enforce strict separation of three operational layers across contracts and tests:
   - **Config allow / activation**: tool presence in `pi.getActiveTools()`, `alwaysOn` model restoration on main-session startup, `advisorModelWhitelist`, and `advisorDisableSameModel`.
   - **Prompt influence**: cooperative Executor instructions controlled by `simpleMode`, `advisorPlanGate`, `advisorFailureGate`, `advisorCompletionGate`, and `advisorCustomInvocation`.
   - **Observed provider call**: actual outbound Advisor/Scout stream or tool execution vs deterministic `autoLoopGate` / `maxCallsPerSession` checks.

### Non-Functional Requirements

- Zero edits to `/home/loidinh/WS/oh-my-pi` or user `~/.omp/agent/advisor.json`; no git commits unless requested; no broad source cleanup.
- Enforce `/home/loidinh/WS/pi-advisor/AGENTS.md` invariants: read [Pi extension docs](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md) before hook/tool/UI edits; keep `src/{config,ui,tools,commands}.ts` facades frozen (`test/facade-exports.test.ts`); preserve public and unknown `advisor.json` fields; never write multi-line comments; keep tool-action blocking and session blocking distinct; keep session summaries local and ephemeral; visually verify call/stream/result/error/blocked states in reloaded TUI.
- Production leaves under `src/**` must never import `src/{config,ui,tools,commands}.ts` facades (`scripts/check-module-boundaries.mjs`); keep imports on `@earendil-works/*` (`no-undeclared-dependencies`).
- Forbid `any`, `ReturnType`, mock-double self-tests, bare private-property `undefined` assertions, and source-text regex tests in all new tests.

## Architecture

### 1. TUI Structural Capability Contracts (`src/ui/types.ts` — Consumed by Phase 02)

- **`HostSymbolTheme` & `HostBoxSymbols` (complete validated host symbol object)**:
  - Matches OMP's `SymbolTheme` (`packages/tui/src/symbols.ts`) attached at `Reflect.get(getSelectListTheme(), "symbols")`:
    - `cursor: string`, `inputCursor: string`, `quoteBorder: string`, `hrChar: string`, `colorSwatch?: string`, `spinnerFrames: string[]`.
    - `boxRound`: record with string keys `topLeft`, `topRight`, `bottomLeft`, `bottomRight`, `horizontal`, `vertical`.
    - `boxSharp` and `table`: records with the 6 `boxRound` keys plus `teeDown`, `teeUp`, `teeLeft`, `teeRight`, `cross`.
  - **Validation algorithm (`isHostSymbolTheme`)**: Verify candidate is a non-null object containing all required string fields, non-empty string array `spinnerFrames`, 6-key `boxRound`, and 11-key `boxSharp`/`table`. Pass the complete validated `HostSymbolTheme` object to **both** `editorTheme.symbols` and `editorTheme.selectList.symbols` so `Editor` and its nested `SelectList` autocomplete never miss symbols.
  - **Diagnostic invariant**: When `"setTheme" in Editor.prototype` is true (OMP `Editor`), if `isHostSymbolTheme(Reflect.get(getSelectListTheme(), "symbols"))` is false, throw `new Error("Incompatible host Editor capability: OMP Editor requires a complete SymbolTheme from getSelectListTheme().")` before constructing the overlay.
- **`HostConfigurableEditor` (`src/ui/manual-dialog.ts` internal)**:
  - Structural methods `setBorderStyle?: (style: "box" | "pi") => void`, `setPaddingX?: (padding: number) => void`, `setTheme?: (theme: unknown) => void`.
- **`SettingsListPublicAdapterContract` (`src/ui/types.ts` / `src/ui/settings-list-adapter.ts`)**:
  - Named structural contract for OMP `SettingsList`: `getSelectedItem(): SettingItem | undefined`, `hasOpenSubmenu(): boolean`, `hasSearchQuery(): boolean`, `openSubmenu: { id: string; component: Component } | undefined`, `selectItem(id: string): boolean`, `updateValue(id: string, newValue: string): void`.
  - **Adapter invariant**: When `hasSettingsListPublicContract(this.list)` holds, every `SettingsListAdapter` method (`submenuComponent`, `setFocused`, `setSelectedId`, `changeWithArrow`) **must return from the public-method branch** before reaching the Pi 1.x `privateFields()` fallback.
- **`InputCursorAdapterContract` (`src/ui/masked-input.ts` internal)**:
  - Named structural contract `{ getCursor?: () => number; cursor?: number }`: call `getCursor()` when it is a function and return the clamped integer cursor `[0, value.length]` before falling back to Pi 1.x `.cursor`.

### 2. Prompt Ownership & Static Asset Contract (Consumed by Phase 03)

- **No prose substring parsing or transport option**:
  - `xd://ask_advisor` and `xd://record_advisor_outcome` remain `discoverable` by default (no `loadMode: "essential"` promotion).
  - Do **not** scan `event.systemPrompt` prose for `"xd://ask_advisor"` and do **not** add `AdvisorTransport` or `AdvisorInvocationGuidelinesOptions`. `advisorInvocationGuidelines(): string[]` retains its 0-arg signature.
  - Instead, the static `.md` instruction assets emit a **conditional routing instruction** referencing the host-advertised schema/catalog: when the host advertises `xd://ask_advisor` (or `xd://record_advisor_outcome`), read the `xd://` URI for its schema when needed and write JSON `content` to that device; when `ask_advisor` (or `record_advisor_outcome`) is directly exposed as a tool, call the tool directly.
- **Unique owned block delimiter contract (internal to `src/tools/register-lifecycle.ts`)**:
  - `ADVISOR_PROMPT_BLOCK_START = "<!-- pi-advisor-flow:invocation-settings:start -->"`
  - `ADVISOR_PROMPT_BLOCK_END = "<!-- pi-advisor-flow:invocation-settings:end -->"`
  - A `systemPrompt: string[]` element is recognized as plugin-owned **only** when it starts with `${ADVISOR_PROMPT_BLOCK_START}\n` and ends with `\n${ADVISOR_PROMPT_BLOCK_END}`. Any foreign block — even one starting with the human heading `"Advisor invocation settings:"` — is preserved untouched in its original order.
- **`DualHostBeforeAgentStartEvent` (`src/tools/types.ts` internal leaf type)**:
  - `{ prompt?: string; systemPrompt?: string[]; systemPromptOptions?: { sections?: Record<string, string | undefined> } }`.
- **Static `.md` instruction assets & build loader contract (Phase 03 creates assets; Phase 01/06 owns manifest/build wiring)**:
  - Proposed static assets (do **not** implement template bodies during planning):
    - `src/tools/prompt-assets.d.ts` (Create — ambient `declare module "*.md"` text export for `bun check` / `NodeNext`)
    - `src/tools/prompts/simple-mode.md` (Create)
    - `src/tools/prompts/plan-gate.md` (Create)
    - `src/tools/prompts/failure-gate.md` (Create)
    - `src/tools/prompts/completion-gate.md` (Create)
    - `src/tools/prompts/invocation-routing.md` (Create)
  - `package.json#scripts.build`: add `--loader .md:text` so `bun build` inlines `.md` imports into `dist/index.js` with zero runtime filesystem reads under `test/default-resource-loader.node.mjs` (`test:node-loader`) or OMP's plugin loader.
  - `scripts/check-package.mjs`: single integration owner registers the sorted `src/tools/prompt-assets.d.ts` and `src/tools/prompts/*.md` paths in `expectedFiles`.

### 3. Host-Specific Settlement & Agent Identity Contract (Consumed by Phase 04)

- **Structural Agent Identity (`src/child-session.ts` & `src/tools/types.ts` internal leaf contracts)**:
  - `HostAgentIdentity`: `{ id: string; kind: "main" | "sub"; name?: string; depth?: number; parentId?: string }`.
  - `AgentAwareContext`: structural context carrying optional `agent?: HostAgentIdentity`, `model`, and `thinkingLevel`.
  - `hasOmpAgentIdentity(ctx)`: returns `true` iff `ctx?.agent` is a non-null object with `(kind === "main" || kind === "sub")` and `typeof id === "string"`. Known Pi 1.x `ExtensionContext` has `undefined` `ctx.agent`.
  - `isMarkedSubagent(ctx?)`: returns `process.env.PI_SUBAGENT_CHILD === "1" || (hasOmpAgentIdentity(ctx) && ctx.agent.kind === "sub")`.
  - `isNativeHostAdvisor(ctx?)`: returns `hasOmpAgentIdentity(ctx) && ctx.agent.kind === "sub" && ctx.agent.id === "advisor"`.
- **Guarded Host-Specific Settlement Selection (`HostAgentEndEvent` in `src/tools/types.ts` & `src/tools/register-lifecycle.ts`)**:
  - `HostAgentEndEvent`: `{ type?: "agent_end"; messages?: unknown[]; willContinue?: boolean }`.
  - Register guarded handlers on both `agent_settled` and `agent_end` that select **only the current host** per invocation (no global host singleton):
    1. `agent_settled` handler: if `hasOmpAgentIdentity(ctx)` is `true`, return immediately; otherwise run final settlement for Pi 1.x.
    2. `agent_end` handler: if `!hasOmpAgentIdentity(ctx) || isNativeHostAdvisor(ctx)` is `true`, return immediately; if `event?.willContinue === true`, return immediately (**never** emit a duplicate/premature session summary, **never** release active `reservedCalls` / `session.clearCallReservations()`, and **never** reset committed usage, follow-up caches, or consultation counts); otherwise (`!event?.willContinue`), run final settlement for OMP.
    3. Final settlement clears only abandoned, unconsumed reservations, preserving IDs whose canonical execution is still active (Phase 04 tracks `activeExecutions`), and emits the local ephemeral `session.summary(...)` at most once per turn cycle (cycle guard reset on `before_agent_start` / `tool_call`).

## Related Code Files

| File Path                                                       | Action | Role / Ownership                                                                                                                                         |
| --------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/home/loidinh/WS/pi-advisor/src/ui/types.ts`                   | Modify | Add `HostBoxSymbols`, `HostRoundedBoxSymbols`, `HostSymbolTheme`, and `SettingsListPublicAdapterContract` (leaf-only; do not re-export from `src/ui.ts`) |
| `/home/loidinh/WS/pi-advisor/src/tools/types.ts`                | Modify | Add `DualHostBeforeAgentStartEvent` and `HostAgentEndEvent` (leaf-only; do not re-export from `src/tools.ts`)                                            |
| `/home/loidinh/WS/pi-advisor/src/child-session.ts`              | Modify | Add `HostAgentIdentity`, `AgentAwareContext`, and `hasOmpAgentIdentity(ctx)` structural helpers consumed by Phase 04                                     |
| `/home/loidinh/WS/pi-advisor/test/helpers/dual-host-harness.ts` | Create | Executable subprocess harness loading built `dist/index.js` in isolated Pi 1.x and real OMP host processes                                               |
| `/home/loidinh/WS/pi-advisor/test/host-contracts.test.ts`       | Create | Observable dual-host boundary tests exercising real Pi 1.x and OMP loaders, symbol themes, and event contracts                                           |
| `/home/loidinh/WS/pi-advisor/test/helpers/harness.ts`           | Modify | Add bounded unit fixture helpers for `before_agent_start` return chaining and `agent_end` / `agent_settled` dispatch                                     |
| `/home/loidinh/WS/pi-advisor/test/helpers/mock-pi.ts`           | Modify | Support async `setActiveTools` promise return and multi-event registration in bounded unit fixtures                                                      |
| `/home/loidinh/WS/pi-advisor/package.json`                      | Modify | Add `--loader .md:text` to `scripts.build` for static `.md` prompt asset bundling                                                                        |
| `/home/loidinh/WS/pi-advisor/scripts/check-package.mjs`         | Modify | Single integration owner updates `expectedFiles` when Phase 03 static `.md` assets are added                                                             |

## Implementation Steps

1. **Freeze Facade & Package Baseline**:
   - Verify `/home/loidinh/WS/pi-advisor` baseline `df0fc3f17bfab7d52e3f64704015e0493dfd9e01` and confirm `src/{config,ui,tools,commands}.ts` exports remain untouched (`test/facade-exports.test.ts`).
2. **Declare Leaf Structural Contracts (`src/ui/types.ts`, `src/tools/types.ts`, `src/child-session.ts`)**:
   - Add `HostSymbolTheme` (complete symbol contract), `SettingsListPublicAdapterContract`, `DualHostBeforeAgentStartEvent`, `HostAgentEndEvent`, `HostAgentIdentity`, and `hasOmpAgentIdentity(ctx)`. Keep internal helpers private to their leaves unless imported by another leaf.
3. **Update `package.json#scripts.build` for Static `.md` Asset Bundling**:
   - Add `--loader .md:text` to `bun build` in `package.json#scripts.build` so Phase 03's static `.md` prompt assets compile inline into `dist/index.js`.
4. **Build Executable Dual-Host Subprocess Harness (`test/helpers/dual-host-harness.ts` & `test/host-contracts.test.ts`)**:
   - Implement isolated `Bun.spawn` child-process runners that load built `dist/index.js` in real Pi 1.1.0 and OMP processes using their actual loaders/components. Apply Phase 06's disposable `HOME`, cleared XDG/profile environment, temporary `PI_CODING_AGENT_DIR`, and verified path isolation from the first harness run; agent-directory isolation alone does not isolate plugins.
   - Verify real host boundaries in `test/host-contracts.test.ts`: tool/command/event registration parity, real OMP `getSelectListTheme().symbols` satisfying `isHostSymbolTheme`, and real Pi vs OMP `ExtensionContext` / settlement discrimination via `hasOmpAgentIdentity(ctx)`.

## Todo List

- [x] Add complete `HostSymbolTheme` and `SettingsListPublicAdapterContract` to `/home/loidinh/WS/pi-advisor/src/ui/types.ts`
- [x] Add `DualHostBeforeAgentStartEvent` and `HostAgentEndEvent` to `/home/loidinh/WS/pi-advisor/src/tools/types.ts` and `HostAgentIdentity` / `hasOmpAgentIdentity` to `/home/loidinh/WS/pi-advisor/src/child-session.ts`
- [x] Add `--loader .md:text` to `scripts.build` in `/home/loidinh/WS/pi-advisor/package.json`
- [x] Create `/home/loidinh/WS/pi-advisor/test/helpers/dual-host-harness.ts` and `/home/loidinh/WS/pi-advisor/test/host-contracts.test.ts`, and update bounded fixture seams in `test/helpers/harness.ts` and `test/helpers/mock-pi.ts`

## Success Criteria

- **Future implementation verification gates (`reports/acceptance-matrix.md` `H1`; not claimed complete during planning)**:
  1. Real isolated Pi 1.x subprocess and real isolated OMP subprocess both load built `dist/index.js` via `test/helpers/dual-host-harness.ts` and register the expected tools, commands, and lifecycle hooks (`H1`).
  2. Real OMP `getSelectListTheme().symbols` in the isolated OMP subprocess satisfies the complete `HostSymbolTheme` validator (`cursor`, `inputCursor`, `boxRound`, `boxSharp`, `table`, `quoteBorder`, `hrChar`, `spinnerFrames`), and real OMP `SettingsList` / `Input` satisfy `SettingsListPublicAdapterContract` / `InputCursorAdapterContract`.
  3. `hasOmpAgentIdentity(ctx)` discriminates real OMP `ExtensionContext` (`ctx.agent.kind` / `ctx.agent.id`) from Pi 1.x `ExtensionContext` without any global singleton.
  4. Focused Phase 01 verification commands pass:
     ```bash
     bun --cwd /home/loidinh/WS/pi-advisor run build
     bun --cwd /home/loidinh/WS/pi-advisor test test/host-contracts.test.ts test/facade-exports.test.ts
     bun --cwd /home/loidinh/WS/pi-advisor run test:node-loader
     bun --cwd /home/loidinh/WS/pi-advisor run typecheck
     bun --cwd /home/loidinh/WS/pi-advisor run check:boundaries
     ```

## Risk Assessment

| Risk                                                                                                                   | Impact | Mitigation                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Accidental export of internal capability types from `src/ui.ts` or `src/tools.ts` breaks `test/facade-exports.test.ts` | Medium | Keep contracts in leaf modules (`src/ui/types.ts`, `src/tools/types.ts`, `src/child-session.ts`) without facade re-exports.                                        |
| In-process module mocking pollutes Bun test runner state                                                               | High   | Run real Pi 1.x and real OMP component/loader checks in isolated child processes via `test/helpers/dual-host-harness.ts`; never use `mock.module`.                 |
| Incomplete symbol validation misses `selectList.symbols` properties                                                    | High   | Validate and forward the complete `HostSymbolTheme` object from `getSelectListTheme().symbols` to both `editorTheme.symbols` and `editorTheme.selectList.symbols`. |

## Security Considerations

- Isolated subprocess tests use Phase 06's disposable `HOME`, cleared XDG/profile environment, and temporary `PI_CODING_AGENT_DIR`; never read or mutate the operator's plugin state or advisor configuration.
- Keep all package imports on `@earendil-works/*` so `no-undeclared-dependencies` and supply-chain checks remain satisfied.

## Next Steps

- Hand off frozen contracts and `test/helpers/dual-host-harness.ts` to **Phase 02** (`phase-02-tui-compatibility.md`) and **Phase 03** (`phase-03-prompt-injection.md`), which execute in parallel across disjoint files (`src/ui/*` vs `src/tools/*`), followed by **Phase 04** (`phase-04-device-lifecycle-safety.md`).

## Unresolved Questions

- None. Runtime capability verification and live-host smoke remain future implementation gates.
