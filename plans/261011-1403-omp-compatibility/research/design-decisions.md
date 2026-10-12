# Design decisions and phase contracts

Status: proposed, not implemented. Parent integration owner. Research reports are source analysis, not runtime proof; line numbers are navigation hints and may drift. OMP working files changed during investigation; re-read named symbols before implementation. Planning helper ran but EVCRATE_SESSION_ID was absent, so active-plan session metadata did not persist. This directory is the explicit handoff.

## Fixed scope and choices

- All product changes belong in `/home/loidinh/WS/pi-advisor`. Preserve Pi 1.x support; OMP is a supported host, not a core fork to edit.
- Preserve package identity `pi-advisor-flow` for local link replacement; do not publish under upstream's name or alter release automation in this task. Keep upstream externals/manifest unless verified integration requires a narrow change.
- Keep `xd://ask_advisor` discoverable by default. No mandatory `loadMode: essential`, and no new transport config. Inject a concise transport instruction: when the host advertises the advisor as `xd://ask_advisor`, read its schema then write JSON content to that device; when the tool is directly exposed, call `ask_advisor`. This avoids brittle parsing of prose to infer mounting. Exact call names/schema remain host-provided. Same rule applies to optional outcome device.
- Reuse global `simpleMode`, `alwaysOn`, `advisorPlanGate`, `advisorFailureGate`, `advisorCompletionGate`, `advisorCustomInvocation` and budget/access settings. No full-gates alias/preset/settings migration. Show accurate descriptions: full gates are executor instructions; always-on restores flow; simple mode suppresses advanced instructions.
- Keep existing startup tool-availability semantics; do not invent defaultInactive policy. Await activation/deactivation mutations in OMP; explicitly disabling flow must suppress instructions and gates. Document availability versus always-on activation distinctly.
- Small fork-owned compatibility boundaries, not a universal adapter framework. Prefer existing adapter files. Editor selection uses a checked capability contract (OMP Editor setTheme plus usable symbols from shared getSelectListTheme), never Function.length. Invalid/mixed capability state produces a diagnostic before constructing a broken overlay; preserve native Pi constructor path.
- Do not normalize cursor glyphs for cosmetic parity. Respect active host symbols. Tests assert usable bounded rendering, input and submission, not exact incidental chrome.
- Plan phases include static prompt assets for new/changed executor instructions, shared by both host event adapters; preserve unrelated existing advisor prompt behavior. Update package file manifest/build loader contract for assets/helpers actually introduced.
- Prompt composition preserves original blocks byte-for-byte/order, returns new arrays, owns only a uniquely delimited advisor block, removes only its own block when disabled, replaces rather than duplicates it, never drops another extension's content. Pi sections mutation remains supported. Unsupported shape reports once without corrupting prompt.
- Prompt-based plan/failure/completion reviews remain cooperative; deterministic hard checkpoints are outside requested scope. Do not add fabricated event hooks that mean 'before plan'/'before success'.

## Research findings requiring bounded implementation verification

- Outer write and inner ask_advisor events share call ID. Normalize exactly recognized advisor-device envelopes once; keep inner execution authoritative for auth, budget, outcomes and provider calls. Ordinary filesystem writes must stay unaffected. Help/invalid JSON/failed dispatch must not invent consultations.
- Pending-invocation Scout projection currently filters direct ask_advisor only. Ensure device JSON gets the same disclosure boundary; exclude draft/attachment bodies from pending Scout projection without weakening write or advisor tool policies. Malformed envelopes must not expose raw content as fallback. Retain explicit draft disclosure to the final Advisor per existing policy.
- Follow-up expiry and loop tracking must ignore the advisor transport envelope, not all writes. Existing non-advisor result counting remains unchanged.
- Host-specific settlement: use Pi agent_settled and OMP agent_end without duplicate summaries or early reservation release. Continuing agent_end returns without cleanup: not-yet-executing reservations may still be queued. Final settlement releases only abandoned reservations and preserves active canonical executions; never reset committed usage/caches merely for continuation.
- Preserve OMP child selected model/effort and prevent shared config persistence using context agent identity in addition to PI_SUBAGENT_CHILD. Propagate context through all helper consumers. Ignore OMP native advisor's own events before changing plugin counters, while not disabling legitimate ordinary child consultations.

## Ordered phases and ownership

1. `phase-01-host-contracts.md`: freeze baseline/host support and small adapter interfaces; define OMP/Pi behavioral harness and package boundaries. No speculative global host detector. This produces interfaces for phases 2 and 3. Owner: integration.
2. `phase-02-tui-compatibility.md`: Editor creation/themes, existing SettingsListAdapter public-method path, masked-input cursor contract; real dialog input/cancel/render and settings toggles. Owner: TUI; does not edit lifecycle/prompt files.
3. `phase-03-prompt-injection.md`: sections + returned systemPrompt boundary, single owned block, transport-aware instructions preserving xd default, all activation/access/simple-mode/individual-gate conditions. Owner: prompt; does not edit UI settings.
4. `phase-04-device-lifecycle-safety.md`: outer/inner device normalization, pending Scout disclosure, host-specific settlement, awaited tool mutations, context-aware child ownership. Owner: lifecycle; starts after phase 3 because register-lifecycle.ts shared.
5. `phase-05-full-gate-settings.md`: existing settings UI/persistence descriptions and behavioral roundtrip, documented opt-in JSON merge example; no user's config writes, no duplicate keys; depends on phases 2–4.
6. `phase-06-integration-and-installation.md`: dual-host integration and actual OMP TUI/provider-boundary smoke; fresh-process bundle identity; package manifest and static assets; local-link/release/rollback guidance; user-facing docs/changelog after passing smoke. No paid provider call without user authorization; deterministic captured request is separate from optional live-model compliance.

After phase 1 verified, phases 2 and 3 may run in parallel (disjoint code). Merge/verify union once. Phase 4 follows 3 and may overlap remaining TUI work only if phase gates/ownership allow. Phase 5 waits for both. Phase 6 final gate. Each phase lists exact files, prerequisites, observable acceptance, commands, security risks, and stop conditions. All implementation statuses remain pending/0%.

## Validation rules

- Do not rerun user-reported crash only to confirm it. Keep failing-before/passing-after regression with real constructor/theme boundary when implementing.
- Do not assert prompt boilerplate; inspect actual provider-boundary request and semantic gate presence/absence via a parser/fixture, and runtime state transitions. Fake providers may capture outbound request for deterministic integration; never label that a real Advisor response.
- Subagent implementers skip tests/build/lint/format. Parent runs focused gates and real surface smoke once per phase/batch; final full gates after integration. No mock.module global mutation.
- Native Pi and OMP module graphs run isolated processes; no in-process global module swapping. Final full OMP monorepo gates are not required if no OMP files changed, but real OMP host loading and TUI interaction are required.
- Local `omp plugin link /home/loidinh/WS/pi-advisor` replaces installed package at same name and changes plugin lock; only future deliberate integration step. Build bundle first; restart OMP. Do not execute installation during planning. Rollback reinstalls recorded npm version and restores backed-up config deliberately.
- Prior `omp plugin install git:github.com/...` recommendation is invalid for checked OMP parser. Verified source syntax is `github:loidinhm31/pi-advisor#<ref>`; remote build lifecycle still requires validation. Local .tgz paths are classified as directory links; use local directory link, not a claimed tarball install.

## Unresolved questions

None require blocking plan creation. Runtime capability matrix, optional live-provider credentials, and bundle/install results are explicitly future validation gates, not claimed successes.
