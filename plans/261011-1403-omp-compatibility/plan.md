---
title: "pi-advisor fork: OMP compatibility and full review instructions"
description: "Adapt the fork's TUI, prompt injection, device lifecycle, and existing gate settings to OMP while preserving Pi 1.x."
status: in-progress
priority: P2
effort: "6 dependency-gated phases; duration estimated at implementation kickoff"
branch: omp/compatibility
tags: [bugfix, api, frontend, compatibility]
created: 2026-10-11
---

# OMP compatibility implementation plan

## Scope and baseline

- Target: `/home/loidinh/WS/pi-advisor`; source baseline `df0fc3f17bfab7d52e3f64704015e0493dfd9e01`, version 0.13.0.
- Reference host: `/home/loidinh/WS/oh-my-pi`; initial HEAD `c9de2b02b997f37cc89639282ed35dec86f139e8`. Working source changed during research; recheck symbols at implementation kickoff.
- Planning complete; implementation **not started**. No source, installed plugin, or user settings changed by this plan.
- Preserve Pi 1.x and OMP support in the fork. No OMP core patch, plugin publication, hard-checkpoint engine, or unrelated cleanup.

## Decisions

1. Preserve `xd://ask_advisor`; inject instructions matching the advertised tool route. Top-level promotion is not required.
2. OMP receives a returned `systemPrompt` array; Pi retains its `systemPromptOptions.sections` path. Preserve other prompt blocks and remove only the plugin-owned block.
3. Reuse existing Simple mode and Plan/Failure/Completion flags. Full instructions require `simpleMode: false`; always-on activates flow, not unconditional consultations.
4. Fix TUI at small fork-owned boundaries. No constructor-arity guessing, unexported theme imports, or OMP private-field assumptions.
5. Normalize advisor device envelopes without double accounting or disclosure; preserve child model ownership and settlement semantics.
6. Prompt instructions are cooperative. Only an observed tool/provider call proves invocation; deterministic loop/access/budget gates remain separate.

## Phases

| Phase | Deliverable | Depends on | Status / progress |
| --- | --- | --- | --- |
| [01 — Host contracts](phase-01-host-contracts.md) | Frozen baseline, capability interfaces, host harness | None | DONE (2026-10-11) / 100% |
| [02 — TUI compatibility](phase-02-tui-compatibility.md) | Manual overlay, settings navigation, masked input | 01 | DONE (2026-10-11) / 100% |
| [03 — Prompt injection](phase-03-prompt-injection.md) | Preserved prompt + correct advisor route and rules | 01 | DONE (2026-10-11) / 100% |
| [04 — Device lifecycle safety](phase-04-device-lifecycle-safety.md) | Accounting, disclosure, settlement, child isolation | 03 | DONE (2026-10-11) / 100% |
| [05 — Full-gate settings](phase-05-full-gate-settings.md) | Existing settings effective and documented | 02, 04 | DONE (2026-10-11) / 100% |
| [06 — Integration and installation](phase-06-integration-and-installation.md) | Dual-host proof, package/link/restart, docs, rollback | 05 | Pending / 0% |

## Execution ownership

- Phase 01 freezes interfaces before consumers. Phases 02 and 03 are disjoint and may run in parallel; collect both terminal reports and verify their union once.
- Phase 04 follows 03: both edit `register-lifecycle.ts`. Phase 05 waits for TUI and lifecycle work. Phase 06 is the final integration gate.
- One integration owner controls shared package manifests, harness, generated bundle and merges; implementation agents skip gates/formatters, parent runs them.
- No phase closes on source review or unit tests alone: exercise its changed surface. Failed gate blocks dependents. No commits unless requested.

## Evidence and acceptance

- [Planning brief / fresh baseline](research/planning-brief.md)
- [Architecture decisions and shared contracts](research/design-decisions.md)
- [TUI and packaging research](research/tui-packaging-research.md)
- [Prompt, settings and lifecycle research](research/prompt-settings-research.md)
- [Requirement and verification matrix](reports/acceptance-matrix.md)
- Research reports include candidate designs; **design-decisions.md and phases take precedence**, particularly settlement selection, transport detection, and cosmetic differences.

## Completion bar

Real OMP manual overlay opens/edits/cancels/submits; settings changes survive reload; captured outgoing prompt contains exactly the enabled instructions and correct route; one real registered device invocation yields one consultation; privacy/access/budget/child boundaries hold; Pi 1.x regression suite and OMP smoke pass; package installs from the intended fork bundle.

## Planning limitations / unresolved questions

- Active-plan helper ran but `EVCRATE_SESSION_ID` was absent; session metadata was not persisted. Use this path explicitly for implementation.
- Dependency/provider installation and runtime compatibility tests are future phase gates, not claimed results. Optional live-provider smoke requires available credentials and permission.
- No user decision blocks implementation planning. Full gate compliance is model-dependent; guaranteed enforcement would be a different scope.
