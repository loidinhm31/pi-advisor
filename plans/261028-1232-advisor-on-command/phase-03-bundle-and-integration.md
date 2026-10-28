# Phase 03 — Rebuild bundle and verify dual-host behavior

## Overview

- Priority: P2. Status: pending. Effort: 25m.
- Dependencies: `register-advisor-on`, `document-advisor-on`. Owner: Main, sole integration/verification owner.
- Context: [overview](plan.md); [Phase 01](phase-01-command-and-activation.md); [Phase 02](phase-02-documentation.md); [host contracts](../../test/host-contracts.test.ts); [development checks](../../docs/development.md); [scripts](../../package.json).

## Design, requirements and ownership

Modify only:

- `/home/loidinh/WS/pi-advisor/test/host-contracts.test.ts`: extend `EXPECTED_COMMANDS`.
- `/home/loidinh/WS/pi-advisor/dist/index.js`: regenerate with the existing build script, never hand-edit.

No product files created/deleted. Preserve current dual-host subprocess harness, tool inventory, events and host capability assertions. Both package entry points load the generated bundle, so source-only tests are insufficient. Existing probe registration parity is a packaged-loading check, not proof that OMP's interactive slash router dispatches the alias.

## Task: integrate-advisor-on

1. After Phase 01 and Phase 02 land, add `"advisor-on"` to `EXPECTED_COMMANDS` in the existing sorted order: `advisor`, `advisor-manual`, `advisor-models`, `advisor-off`, `advisor-on`, `advisor-settings`, `advisor-stats`. Keep both Pi and OMP comparisons against the same list.
2. Confirm execution prerequisites without changing installations: Bun >=1.4.3, existing development dependencies, supported Pi 1.x runtime, available OMP checkout/executable. The harness resolves `OMP_ROOT` or defaults to `/home/loidinh/WS/oh-my-pi`. Report a missing dependency/host; never manufacture parity from mocks or skips.
3. Run **`bun run build`** once after all product edits. This must regenerate `dist/index.js` from `extensions/index.ts` with the existing externals and Markdown loader. Do not change the build script or package metadata.
4. Main runs coherent project verification, serially against the rebuilt artifact:
   - `bun run test` — Bun suite, including registration/activation/built-host contracts, followed by the Node resource-loader suite. Report exact failures and any skipped host checks separately.
   - `bun run typecheck` — existing `bun check` gate.
   - `bun run check:boundaries` — unchanged module-boundary gate.
   - `bun run lint` — repository lint, no unrelated autofix.
   - `bun run package:check` — packed bundle/resource contract.
   - If preparing a PR, also run the remaining documented PR checks from `docs/development.md`: `bun audit --audit-level=high` and `git -c diff.stat=false diff --no-ext-diff --check --no-stat`. Audit requires network availability; preserve its blocked/failure outcome rather than modifying dependencies in this scope.
5. Optional focused diagnosis after a failure: `bun test test/command-registration.test.ts test/activation.test.ts test/host-contracts.test.ts`. This is not a replacement for the full required suite, and a later pass must not erase earlier failures.
6. Perform fresh-process host smoke, in disposable host homes/agent directories and a synthetic working directory, not the live session or global user configuration:
   - OMP: load the rebuilt plugin through the supported plugin-loading path; `/advisor-on` must reach pi-advisor activation/model selection rather than the native advisor. Canceling the first-use picker must not enable or persist the flow. With existing authorized model/auth fixtures, complete activation, observe pi-advisor tools/status, then `/advisor-off`; invoke native `/advisor` separately and confirm its existing host behavior is unchanged.
   - Pi 1.x: in a fresh process, activate using `/advisor-on`, turn off, then activate using `/advisor`; both must reach the same model selection/flow behavior. Exercise argument overrides where the synthetic runtime has available authenticated model fixtures.
   - No paid model generation is required by the alias; do not add provider calls, enter secrets, mutate installed/live host configuration or install dependencies merely to obtain a smoke result. If complete authenticated activation is unavailable, record picker/routing evidence separately and mark full activation smoke blocked. Do not call registration probes interactive routing evidence.
7. Record exact commands, runtime/host context, results, failures/skips and untested surfaces in Main's integration report. Obtain final implementation/docs review under the parent workflow. No native-host, full-suite or code-approval claim without matching observed evidence.

## Success and failure criteria

- Generated bundle and isolated Pi/OMP probes register all seven commands; legacy command/tool/event contracts remain intact.
- Full project checks pass with any environmental limits explicitly retained. Both host routing smokes cover their actual user surfaces, or remain explicitly incomplete.
- Docs and inventory agree; no release bump, config migration or host-core modification.
- Missing hosts/credentials block the corresponding evidence, not permission to suppress assertions, remove tests, modify helpers or describe untested compatibility as proven.
- Repairs outside the two owned files return to Main for bounded ownership updates; a failed gate never authorizes unrelated cleanup.

## Risk, safety and rollback

- Cached bundles: use fresh OS processes, not only `/reload` in an existing host.
- Shared configuration refs: existing fixture isolation; serialize final suite and host smoke. Clean only disposable resources created for this run.
- Privacy/security behavior remains inherited from shared activation; no new data flow, secret store or network request.
- Rollback restores only this feature's source/tests/docs changes and rebuilds `dist/index.js` again; verify the previous six-command contract. Never reset unrelated work or edit generated bytes by hand.

## Durable task contract

```evcrate-tasks
[
  {
    "id": "integrate-advisor-on",
    "title": "Update built-host contracts, regenerate bundle and verify integration",
    "blocked_by": ["register-advisor-on", "document-advisor-on"],
    "allowed_files": [
      "test/host-contracts.test.ts",
      "dist/index.js"
    ],
    "constraints": [
      "Main is the sole integration and verification owner; run checks after both dependent tasks land.",
      "Generate dist/index.js only via bun run build; preserve the harness, other host assertions, package scripts and versions.",
      "Use disposable host environments; no dependency installation, paid provider request, live user settings mutation, commit or push."
    ],
    "acceptance": [
      "Both isolated built-host probes expect seven commands including advisor and advisor-on, and the generated bundle contains the new registration.",
      "Required build/project checks and fresh Pi/OMP routing smokes have observed outcomes; missing-host or authentication evidence remains explicitly blocked rather than passed.",
      "Both Pi activation names and OMP advisor-on behavior match documentation, with OMP native advisor behavior untouched."
    ],
    "verification": [
      "Run bun run build before bun run test, bun run typecheck, bun run check:boundaries, bun run lint and bun run package:check; retain exact per-command results.",
      "Use fresh disposable OMP/Pi processes to exercise advisor-on activation/picker, advisor-off and the legacy/native advisor distinction; report unavailable full-activation prerequisites honestly.",
      "Main records final review, any additional documented PR checks, failures, skips and untested surfaces; source-level or registration-only success is not interactive host qualification."
    ]
  }
]
```

- [ ] <!-- evcrate-task:integrate-advisor-on --> Rebuild bundle and collect integrated verification
