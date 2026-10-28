# Phase 02 — Document collision-free activation

## Overview

- Priority: P2. Status: pending. Effort: 15m.
- Dependency: `register-advisor-on`. Owner: documentation owner assigned by Main.
- Context: [overview](plan.md); [Phase 01](phase-01-command-and-activation.md); [README](../../README.md); [configuration](../../docs/configuration.md); [changelog](../../CHANGELOG.md).

## Requirements and writable files

Modify only:

- `/home/loidinh/WS/pi-advisor/README.md`: OMP guidance, quick start, activation explanation/example and command table.
- `/home/loidinh/WS/pi-advisor/docs/configuration.md`: activation overrides and interactive model-selection guidance.
- `/home/loidinh/WS/pi-advisor/CHANGELOG.md`: additive alias entry under existing `Unreleased` / `Added`.

No files created/deleted, no version bump, no rewording historical release entries. Documentation reflects one shared activation pipeline, not a separate OMP mode.

## Task: document-advisor-on

1. Explain near the README OMP section: use `/advisor-on` for pi-advisor because OMP already owns `/advisor` for its native advisor. Do not suggest the plugin intercepts or replaces that built-in.
2. Change README current quick-start activation spelling to `/advisor-on`; update adjacent first-use/model-selection prose and the `executor=... advisor=...` example consistently. State both spellings have identical pi-advisor behavior where dispatched to the plugin.
3. Add `/advisor-on` as the preferred activation row in the command table; keep `/advisor` visible as the backward-compatible Pi 1.x alias. Keep `/advisor-off` unchanged and make enable/disable symmetry clear.
4. In `docs/configuration.md:7–9`, use `/advisor-on` in current activation override examples and model-picker guidance. Explicitly retain `/advisor` as the Pi alias, with the same `executor=`, `advisor=` and `contextMaxChars=` handling. Keep picker/authentication/persistence claims unchanged.
5. Add one concise Unreleased Added bullet: `/advisor-on` avoids OMP's built-in `/advisor` collision; `/advisor` remains available for Pi 1.x compatibility. Do not claim OMP's built-in command has changed.
6. Manually inspect affected current guidance for conflicting spellings, arguments and host claims. Preserve historical `/advisor` mentions and unrelated content; avoid blanket repository replacement.

## Acceptance and risks

- A reader following OMP setup and quick start can enable the plugin without using the colliding name.
- Pi 1.x users can still discover `/advisor`; both names' shared semantics are explicit.
- No new privacy, credential, persistence or runtime behavior is documented. Documentation must not imply a native-host smoke already passed.
- Main reviews documentation alongside the implemented command inventory during Phase 03; no documentation or formatter checks run mid-flight.
- Rollback: revert only this feature's current documentation/Unreleased additions if the feature is withdrawn. Preserve pre-existing edits and release history.

## Durable task contract

```evcrate-tasks
[
  {
    "id": "document-advisor-on",
    "title": "Document advisor-on as the collision-free activation spelling",
    "blocked_by": ["register-advisor-on"],
    "allowed_files": [
      "README.md",
      "docs/configuration.md",
      "CHANGELOG.md"
    ],
    "constraints": [
      "Preserve advisor as the Pi 1.x alias and explain OMP native advisor ownership; no claim of built-in command override.",
      "Update only current activation guidance and the existing Unreleased section; preserve release history, versions and unrelated documentation.",
      "Do not run build, tests, lint or formatters during this phase."
    ],
    "acceptance": [
      "README OMP instructions, quick start, argument example and command table consistently recommend advisor-on while retaining the Pi alias.",
      "Configuration guidance documents identical activation overrides and interactive model selection for both names.",
      "Unreleased changelog records the additive alias and its OMP collision rationale without a release bump."
    ],
    "verification": [
      "Main inspects affected docs against the seven-command inventory and shared activation contract during final integration.",
      "Confirm no current OMP activation example requires the built-in advisor command and no historical release entry was rewritten."
    ]
  }
]
```

- [ ] <!-- evcrate-task:document-advisor-on --> Update README, configuration guide and changelog
