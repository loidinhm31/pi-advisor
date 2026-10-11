# Project Roadmap: OMP Compatibility & Dual-Host Architecture

## Overview

The `omp/compatibility` roadmap adapts `pi-advisor` to run seamlessly on both Pi 1.x (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`) and Oh-My-Pi (OMP, `@oh-my-pi/pi-tui`) runtimes while preserving full backward compatibility.

Implementation is executed in six dependency-gated phases:

| Phase | Deliverable | Scope | Status | Completed |
| --- | --- | --- | --- | --- |
| [Phase 01](#phase-01-host-contracts-capability-boundaries--test-harness) | Host Contracts & Harness | Capability interfaces, isolated subprocess test harness | DONE | 2026-10-11 |
| [Phase 02](#phase-02-tui-compatibility-manual-dialog-settings-adapter--masked-input) | TUI Compatibility | Manual dialog overlay, settings adapter, masked input | DONE | 2026-10-11 |
| [Phase 03](#phase-03-prompt-injection-preserved-prompt--route-rules) | Prompt Injection (`phase-03-prompt-injection.md`) | System prompt section preservation and tool route alignment | DONE (2026-10-11) / 100% | 2026-10-11 |
| [Phase 04](#phase-04-device-lifecycle-safety) | Device Lifecycle Safety (`phase-04-device-lifecycle-safety.md`) | Accounting normalization, disclosure safety, child session isolation | DONE (2026-10-11) / 100% | 2026-10-11 |
| Phase 05 | Full-Gate Settings | Verification and documentation of settings and loop gates | Pending | — |
| Phase 06 | Integration & Installation | Dual-host end-to-end verification, packaging, and release docs | Pending | — |

---

## Architectural Principles

1. **Capability Detection Over Version Guessing**: Detect runtime feature availability via prototype inspection (e.g. `"setTheme" in Editor.prototype`) rather than constructor arity, environment sniffing, or version string checks.
2. **Public-First Interface Contracts**: Interact with host TUI components through public methods (`SettingsListPublicAdapterContract`, `resolveInputCursor`) before falling back to private property access on legacy hosts.
3. **Isolated Dual-Host Verification**: Run regression suites against Pi 1.x in-process and against OMP components in an isolated child process via `test/helpers/dual-host-harness.ts` to prevent cross-host prototype pollution.
4. **Conservative Fallbacks**: Guarantee complete backward compatibility with Pi 1.x environments with zero degradation in UI layout, keybindings, or secret masking.

---

## Phase Milestones

### Phase 01: Host Contracts, Capability Boundaries & Test Harness

- **Status**: Completed (2026-10-11)
- **Delivered**:
  - Defined host symbol contracts (`HostSymbolTheme`, `HostBoxSymbols`, `HostRoundedBoxSymbols`) and public adapter contracts (`SettingsListPublicAdapterContract`) in `src/ui/types.ts`.
  - Added child session and agent identity boundary detection in `src/child-session.ts`.
  - Created isolated dual-host subprocess harness and probes in `test/helpers/dual-host-harness.ts` and `test/helpers/dual-host-probes.ts`.

### Phase 02: TUI Compatibility (Manual Dialog, Settings Adapter & Masked Input)

- **Status**: Completed (2026-10-11)
- **Delivered**:
  - **Manual Advisor Dialog (`src/ui/manual-dialog.ts`)**:
    - Replaced direct host editor instantiation with `createManualDialogEditor`.
    - Validates complete `HostSymbolTheme` from `@earendil-works/pi-coding-agent` select-list theme before constructing the OMP editor.
    - Instantiates OMP editor with 1-arg signature when `"setTheme" in Editor.prototype` is true.
    - Configures `setBorderStyle?.("pi")` and `setPaddingX?.(0)` to eliminate nested border boxes and match Pi 1.x framing.
    - Preserves 2-arg editor fallback on Pi 1.x.
  - **Settings List Adapter (`src/ui/settings-list-adapter.ts`)**:
    - Implemented `hasSettingsListPublicContract` matching `SettingsListPublicAdapterContract`.
    - On OMP, reads and modifies settings state via public methods (`getSelectedItem`, `selectItem`, `hasOpenSubmenu`, `hasSearchQuery`, `updateValue`, `openSubmenu`), returning early before touching private properties.
    - Preserves TS private-field access (`filteredItems`, `selectedIndex`, `searchInput`, `submenuComponent`) as fallback for Pi 1.x.
  - **Masked Input (`src/ui/masked-input.ts`)**:
    - Implemented `resolveInputCursor` preferring `input.getCursor()` over `input.cursor`.
    - Clamps resolved caret position to integer range `[0, value.length]`, preventing non-finite bullet masking calculations and rendering bullets `•` and cursor `█` cleanly in both hosts.
  - **Packaging and Test Harness Updates**:
    - Updated `scripts/check-package.mjs` to accept both array and object payloads from `npm pack --dry-run --json`.
    - Extended `test/helpers/dual-host-harness.ts` and test suite (`test/ui.test.ts`, `test/manual-dialog.test.ts`, `test/settings-navigation.test.ts`) with dual-host test coverage.

### Phase 03: Prompt Injection (Preserved Prompt & Route Rules)

- **Status**: DONE (2026-10-11) / 100% (`phase-03-prompt-injection.md`)
- **Scope**: Ensure prompt sections and tool route alignment (`xd://ask_advisor`) are cleanly registered across both hosts without clobbering existing system prompt blocks.

### Phase 04: Device Lifecycle Safety

- **Status**: DONE (2026-10-11) / 100% (`phase-04-device-lifecycle-safety.md`)
- **Delivered**:
  - **Shared Canonical Target Helper (`src/content-utils.ts`)**:
    - Implemented `advisorDeviceTarget(toolName, inputOrArgs?, details?)` strictly matching canonical `xd://ask_advisor` and `xd://record_advisor_outcome` targets (plus `details.xdev.tool` outer markers) to distinguish outer device envelopes from ordinary filesystem writes.
  - **Lifecycle Hook Normalization & Settlement (`src/tools/register-lifecycle.ts`, `src/tools/register-ask-advisor.ts`, `src/tools/jev-turn-gate.ts`)**:
    - Outer `write` envelopes for advisor devices bypass loop-gate streaks (`handleAutomaticGate`) and follow-up expiration, preserving the 2-result survival / 3rd-result expiry window (`toolCallsSince + 1 >= 3`).
    - Inner and direct `record_advisor_outcome` calls preserve accurate 1-call non-Advisor counting.
    - Pre-execution validation/abort consumes 0 budget slots; post-`consumeCall` provider calls preserve consumed budget slots.
    - Handled Pi 1.x `agent_settled` and OMP `agent_end` settlement events; `willContinue: true` retains active and queued reservations without summary emission, while final settlement cleans up abandoned reservations and emits at most one ephemeral summary.
  - **Subagent & Native Host Isolation (`src/child-session.ts`, `src/commands/`)**:
    - Enhanced `isMarkedSubagent(ctx)` to recognize in-process subagents (`ctx.agent?.kind === "sub"`), preserving child session model and thinking level without persisting changes to `advisor.json`.
    - Added `isNativeHostAdvisor(ctx)` (`ctx.agent?.kind === "sub" && ctx.agent?.id === "advisor"`), preventing host native advisor turns from polluting plugin turn counts or gate metrics.
    - Ensured `pi.setActiveTools()` is properly awaited in `/advisor` and `/advisor-off` commands.
  - **Scout Group Privacy Sanitization (`src/scout-groups.ts`)**:
    - Pending `write xd://ask_advisor` calls in `pendingInvocationDisclosure` sanitize input arguments to expose only `path`, `gitContext`, and `question`, scrubbing `draft`, `includeTrackedFiles`, and `includeUntracked`, and falling back cleanly to `"{}"` on malformed JSON.

### Phase 05: Full-Gate Settings

- **Status**: Pending
- **Scope**: Verify that loop gates, failure modes, budgets, and settings work reliably across both hosts.

### Phase 06: Integration, Dual-Host Verification & Release

- **Status**: Pending
- **Scope**: Final end-to-end integration proof across Pi 1.x and OMP, package build verification, and user-facing installation documentation.

---

## Verification & Quality Gates

Each roadmap phase must satisfy strict validation gates:

- Boundary checks: `bun run check:boundaries`
- Type checking: `bun run typecheck`
- Linting: `bun run lint`
- Test suite: `bun run test` (including dual-host tests in `test/ui.test.ts`, `test/manual-dialog.test.ts`, `test/settings-navigation.test.ts`)
- Package checks: `bun run package:check`
