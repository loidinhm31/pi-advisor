# Development

## Local setup

```bash
git clone git@github.com:philipbrembeck/pi-advisor.git
cd pi-advisor
bun install
bun run build
```

Use Bun 1.4.4 or newer; the repository's `preinstall` check rejects older versions unless lifecycle scripts are disabled. The check skips packed installs, so package consumers don't need Bun. `bun run typecheck` uses the `bun check` command.

Both Pi (`package.json#main`) and OMP (`package.json#pi.extensions: ["./dist/index.js"]`) load `dist/index.js`, which bundles internal modules and inline static Markdown prompt assets (`src/tools/prompts/*.md` via `--loader .md:text`, typed in `src/tools/prompt-assets.d.ts`) so settings controls, persistence, and Node `DefaultResourceLoader` imports (`bun run test:node-loader`) share one self-contained runtime bundle. Run `bun run build` once after checkout, then reload the host. The pre-commit hook rebuilds and stages the bundle after linting source changes; `prepack` also rebuilds it for npm packaging.

A rebuilt bundle is not always picked up by in-process `/reload` in a running host: running Node/Bun processes can keep serving the cached `dist/index.js`. Always rebuild (`bun run build`) and start a **fresh OS process** (`pi -c` or `omp`) to load bundle changes reliably.

## Checks

Run the full project checks before opening a pull request:

```bash
bun run test
bun run typecheck
bun run check:boundaries
bun run lint
bun run package:check
bun audit --audit-level=high
git -c diff.stat=false diff --no-ext-diff --check --no-stat
```

`bun run format` formats the project with Bun's native formatter; `bun run format:check` verifies it. The pre-commit hook uses lint-staged to run Bun fmt and Oxlint on staged files while preserving partially staged changes.

`bun test` covers the normal suite. Run `bun run test:bench` for the repository-only benchmark tests.

### Dual-host & TUI testing

The test suite validates TUI compatibility across both Pi 1.x and Oh-My-Pi (OMP) environments (`test/ui.test.ts`, `test/manual-dialog.test.ts`, `test/settings-navigation.test.ts`):

- In-process tests verify Pi 1.x components (`ManualAdvisorDialog`, `SettingsListAdapter`, `MaskedInput`).
- Subprocess harness tests (`test/helpers/dual-host-harness.ts`, `test/helpers/isolated-omp-plugin-link.ts`) verify OMP components, plugin linking (`omp plugin link`), and capability contracts in an isolated child process with disposable `HOME` and cleared XDG variables to prevent prototype pollution or live configuration mutations.
- Set `OMP_ROOT` to specify an alternate OMP checkout path; OMP-specific subprocess tests skip cleanly when absent.
- Dual-host `before_agent_start` prompt injection (`src/tools/register-lifecycle.ts`) populates Pi 1.x `systemPromptOptions.sections.advisor_invocation_settings` or appends a delimited `<!-- pi-advisor-flow:invocation-settings:start -->`…`<!-- pi-advisor-flow:invocation-settings:end -->` block to OMP's `systemPrompt` `string[]` array (`test/{consultation,activation,model-whitelist,budget}.test.ts`, `test/default-resource-loader.node.mjs`). `src/tools/register-ask-advisor.ts` exceeds the usual ~300-line target because registration and the sequential screening, budget, one-shot handoff, streaming, and error cleanup path share one ordered execution boundary; splitting that boundary risks changing when a call becomes chargeable or consumes consent.

GitHub Actions manages release tags and publishing from `package.json`. Do not create release tags manually.
