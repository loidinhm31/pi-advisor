# OMP compatibility planning brief

## Scope

Create an implement-later plan for `/home/loidinh/WS/pi-advisor`; no source, runtime configuration, installed plugin, or OMP edits. Execute the published `evc-cmd-plan-x-hard` procedure using native tools and the planning skill; no command-invocation tool is available in this session.

Requested surfaces, individually tracked:

1. Rescan the freshly merged fork and current OMP integration contracts.
2. Diagnose and plan fixes for `/advisor-manual` TUI rendering and related settings interactions.
3. Restore system-prompt injection with correct `xd://ask_advisor` invocation instructions in OMP.
4. Expose/use settings for full Plan, Failure, and Completion instructions, retaining Simple mode and per-gate control.

## Baseline

- Fork: `df0fc3f17bfab7d52e3f64704015e0493dfd9e01`, main, version 0.13.0; initially clean.
- Fork origin: `https://github.com/loidinhm31/pi-advisor`; no upstream remote shown by `git remote -v`. Do not fetch/merge again or infer upstream freshness beyond the checked-out revision.
- OMP: `/home/loidinh/WS/oh-my-pi`, `c9de2b02b997f37cc89639282ed35dec86f139e8`; pre-existing untracked `plans/` must remain untouched.
- Runtime: Linux x64, Asia/Saigon, 2026-10-11.
- `package.json` builds `extensions/index.ts` into `dist/index.js`; pi manifest loads the bundle, not edited source directly. Development dependencies pin Pi 1.1.0, peers allow Pi ^1.0.0.
- Generic project-overview/codebase-summary/system-architecture/code-standards documents listed in command template are absent. Read actual README, docs/development.md, docs/configuration.md, docs/privacy.md and use fresh scoped scouts instead. No architecture.md present; proposed design belongs in this plan, not an invented description of implemented behavior.

## Freshly confirmed facts

- `src/tools/register-lifecycle.ts:74-99` returns before generating guidelines if `event.systemPromptOptions.sections` is absent.
- `src/ui/manual-dialog.ts:67-77` builds upstream theme and calls `new Editor(tui, editorTheme)`.
- User global config still has `simpleMode: true`, `alwaysOn: true`; Gemini executor is now whitelisted and differs from primary Sol advisor. Do not copy or alter the global configuration.
- Existing `advisorPlanGate`, `advisorFailureGate`, `advisorCompletionGate` and Simple mode already exist; prefer repairing their integration over a duplicate settings family.

## Decisions to preserve in plan

- Fork-side changes; OMP core and installed node_modules are read-only references.
- Keep Pi 1.x compatibility through small explicit host boundaries; no blanket API rewrite.
- Keep OMP `xd://ask_advisor` transport as default. Promoting tools to essential is an alternative, not a prerequisite to injection.
- Full gate instructions influence executor behavior; not deterministic pre-plan or pre-completion interceptors. Always-on enables flow, not a consultation each session/turn.
- Never use `Editor.length`, blanket type suppression, or guessed symbol exports as proven integration APIs.
- Preserve global-only configuration, explicit false, whitelist/same-model checks, privacy, budgets, cancellation, provider fallback, and child-session model ownership.
- Future tests must assert observable behavior, not copied prompt boilerplate or implementation source text. Real OMP TUI and provider-boundary smoke remain required before implementation completion.

## Planning verification

This task validates plan artifacts and source evidence, not a patched runtime. Earlier installed-plugin provider smoke succeeded in this conversation, but does not prove this fork's future integration or the active executor identity. No paid calls needed for plan creation.

## Unresolved questions

Host adapter shape and package install syntax are being verified by the two scoped research agents; decisions will be settled in plan.md and phase files.
