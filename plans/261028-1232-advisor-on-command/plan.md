---
title: "Add /advisor-on activation alias"
description: "Expose collision-free pi-advisor activation in OMP while retaining /advisor compatibility in Pi 1.x."
status: pending
priority: P2
effort: 1h
branch: omp/compatibility
tags: [bugfix, commands, omp, compatibility]
created: 2026-10-28
---

# /advisor-on command implementation plan

## Outcome and decisions

- Register `advisor-on` and retain `advisor` on both hosts. Both use the existing description and `(args, ctx) => activateAdvisor(runtime, args, ctx)` behavior.
- Prefer `/advisor-on` in current user-facing activation examples; document `/advisor` as the Pi 1.x backward-compatible alias. OMP's built-in `/advisor` remains host-owned and is not overridden by this change.
- Reuse the activation pipeline; no new parser, configuration, host detection, command interception, lifecycle behavior, or dependency.
- Explicit user-selected directory takes precedence over injected timestamp naming. Planning only: no implementation, generated-bundle changes, task-state hydration, commits or installation performed.

## Phases and ownership

| Phase                                                                      | Deliverable                                                           | Dependency   | Status  | Effort |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------ | ------- | ------ |
| [01 — Command and activation coverage](phase-01-command-and-activation.md) | Alias registration, exactly seven commands, behavioral parity tests   | None         | Pending | 20m    |
| [02 — User documentation](phase-02-documentation.md)                       | README, configuration guide, Unreleased changelog                     | Phase 01     | Pending | 15m    |
| [03 — Bundle and integration](phase-03-bundle-and-integration.md)          | Built-host contract update, regenerated bundle, coherent verification | Phases 01–02 | Pending | 25m    |

One implementation owner handles Phase 01; documentation owner handles Phase 02; Main is integration owner for Phase 03 and final verification. These are sequential handoffs, not concurrent writers. Durable task IDs and exact writable files live in each linked phase.

## Repository evidence

- `src/commands/model-commands.ts:20–25`: existing activation registration delegates directly to `activateAdvisor`; add its alternate name here.
- `src/commands/activation.ts:66–152`: shared parsing, picker/authentication, persistence, awaited tool enablement and announcement must remain unchanged.
- `test/command-registration.test.ts:29–45`: six-command registration assertions currently lack an exact count.
- `test/activation.test.ts:145–307,559–585,640–658`: reusable picker, cancellation, asynchronous activation and argument-persistence coverage.
- `test/host-contracts.test.ts:26–59`: both subprocess probes load `dist/index.js` and compare the same expected command list.
- `package.json:31–54,114–118`; `docs/development.md:12–41`: build command, bundle entry points, Bun >=1.4.3, isolated-host harness and fresh-process reload requirement.
- `README.md:68–110,163–172`; `docs/configuration.md:7–9`; `CHANGELOG.md:7–21`: current activation examples, command table and Unreleased section.

## Acceptance

1. Both `advisor-on` and `advisor` register with identical descriptions and invoke the unchanged activation pipeline with original arguments/context; seven commands total.
2. Both names activate available saved models, support first-use selection, forward activation overrides, and preserve cancellation and awaited tool-state behavior. Legacy coverage remains.
3. Rebuilt `dist/index.js` exposes seven expected commands through both existing isolated Pi/OMP probes. Registration evidence alone is not interactive slash-dispatch evidence.
4. Fresh OMP process: `/advisor-on` reaches pi-advisor; `/advisor-off` disables it; native `/advisor` remains independent. Fresh Pi 1.x process: both activation names work.
5. README and configuration examples use the collision-free spelling and explain the Pi alias/OMP collision; Unreleased changelog records the additive command. No release/version bump.
6. Main records build, project checks, host smoke outcomes and any unavailable-host limitation accurately; no skipped or unexecuted gate reported as passed.

## Risks, scope and rollback

- Main risk: source-only success with stale packaged bundle. Build before bundle-dependent tests; restart hosts in fresh OS processes.
- Alias drift: share activation implementation and description; exercise behavior, not handler identity or mocked activation.
- Configuration, authentication, privacy and subagent protections stay in `activateAdvisor`; no new network calls or persistence schema. Startup adds one registration only; no new per-turn cost.
- No architecture document exists at `docs/architecture.md` or `ARCHITECTURE.md`; record documentation gap, do not invent an architecture rewrite for this bounded alias.
- Related plan: `plans/261011-1403-omp-compatibility/plan.md` is informational; its status label is not implementation evidence. Current source confirms the reused dual-host boundary. Do not edit it; serialize any concurrent writes to this plan's listed product files.
- Rollback only this feature's registration/tests/docs changes, then rebuild the bundle from restored source; preserve all unrelated work. No configuration migration to undo.

## Planning disposition

- Local evidence sufficient; external research unnecessary for the settled additive registration design.
- Authoring contract inspected in actual linked artifacts; no execution state created. Independent review and final validation remain coordinator-owned, not performed by this authoring assignment.
- Handoff status: **pending-validation**. No build, test, lint, native-host qualification or implementation approval claimed.
- Active-plan setter was invoked from the published installation; `EVCRATE_SESSION_ID` is unset, so session persistence is unavailable. Pass this selected plan path explicitly to subsequent work.

## Unresolved questions

None. Host availability and credential-free smoke setup are execution prerequisites, not design decisions.
