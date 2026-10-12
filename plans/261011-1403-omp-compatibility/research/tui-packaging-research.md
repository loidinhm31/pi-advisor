# TUI & Packaging Compatibility Report

## 1. OMP Loader Aliases & Shim Surface

- **Specifier rewriting** (`packages/coding-agent/src/extensibility/plugins/legacy-pi-compat.ts:806-839,968-1155`):
  - `PI_SCOPE_ALIASES = ["oh-my-pi", "mariozechner", "earendil-works"]` + `PI_PACKAGE_NAMES = ["pi-agent-core", "pi-ai", "pi-catalog", "pi-coding-agent", "pi-natives", "pi-tui", "pi-utils"]` are rewritten to `@oh-my-pi/*`.
  - Subpath remaps (`legacy-pi-compat.ts:825-829`): `pi-ai/utils/oauth` -> `pi-ai/oauth`, `pi-ai/compat` -> `pi-ai`.
  - Package roots resolve to `legacy-pi-ai-shim.ts`, `legacy-pi-coding-agent-shim.ts`, `legacy-pi-tui-shim.ts` (or `omp-legacy-pi-bundled:<key>` in compiled/bundled mode).
- **`legacy-pi-tui-shim.ts` (`packages/coding-agent/src/extensibility/legacy-pi-tui-shim.ts:1-91`)**:
  - `export * from "@oh-my-pi/pi-tui"` + `decodeKittyPrintable` alias + `compositeTuiLine` + Kitty image helpers. Does **not** wrap `Editor`, `SettingsList`, or `Input`.

## 2. TUI Constructor, Theme, Symbols & Input Map (Pi 1.x vs OMP)

| Surface | Pi 1.x (`@earendil-works/pi-tui@1.1.0`) | OMP (`@oh-my-pi/pi-tui@18.8.9`) | Impact in `pi-advisor` |
| --- | --- | --- | --- |
| `Editor` ctor | `new Editor(tui: TUI, theme: EditorTheme, options?: EditorOptions)` (`editor.d.ts:71`) | `new Editor(theme: EditorTheme)` (`packages/tui/src/components/editor.ts:789`) | `manual-dialog.ts:73` passes `options.tui` as 1st arg -> OMP assigns `tui` to `#theme`, `this.borderColor = undefined`, and crashes on render. |
| `EditorTheme` | `{ borderColor, selectList }` (`editor.d.ts:25-28`) | `{ borderColor, selectList, symbols: SymbolTheme, ... }` (`editor.ts:498-511`) | OMP `Editor.render` reads `this.#theme.symbols.boxRound` (`editor.ts:1388`) and `this.#theme.symbols.inputCursor` (`editor.ts:1264`). Missing `symbols` throws `TypeError`. |
| `Editor` chrome | Top/bottom `─` rules, no side borders, `paddingX = 0` (`editor.js:343-410`) | Default `#borderStyle = "box"` (`╭─╮`/`╰─╯`, `paddingX = 2`); also has `"pi"` style (`composer/pi.ts:9-36`) | Default `"box"` nests a second rounded box inside `ManualAdvisorDialog` and breaks `"│ x"` layout (`test/ui.test.ts:198`). Calling `editor.setBorderStyle?.("pi"); editor.setPaddingX(0)` in OMP matches Pi 1.x output. |
| `SymbolTheme` root access | Not exported in Pi 1.x (`pi-tui` / `pi-coding-agent`) | Exported in OMP, **and** attached as `.symbols` on `getSelectListTheme()` & `getMarkdownTheme()` (`tui-adapters.ts:241,260,272`) | Do **not** static-import `getSymbolTheme` (breaks Pi 1.x `tsc` and Node ESM loader). Read `Reflect.get(getSelectListTheme(), "symbols")` from `@earendil-works/pi-coding-agent` (root export in both hosts, safe before `initTheme()` in OMP via ASCII fallback at `tui-adapters.ts:154-277`). |
| `Editor` input / keys | `handleInput`, `getText`, `setText`, `getCursor`, `onChange`, `onSubmit` | Same method signatures (`editor.ts:1773,2828,2937,3030`). `\n` inserts newline (`editor.ts:2112`), `\r` submits (`editor.ts:2122`), Up/Down at first/last visual line clamps cursor (`editor.ts:2201-2220`). | `ManualAdvisorDialog.handleEditorInput` cursor-edge detection (`manual-dialog.ts:136-153`) and `TUI_KEYBINDINGS` IDs (`tui.input.tab`, `tui.input.submit`, `tui.select.*`, `tui.editor.cursor*`) work identically in both hosts once `Editor` is constructed properly. |
| `SettingsList` state | TS `private` fields (`filteredItems`, `searchInput`, `selectedIndex`, `submenuComponent`) on instance (`settings-list.js:5-18`) | ES `#private` fields (`#filteredItems`, `#selectedIndex`, `#filterQuery`, `#submenuComponent`); public API: `getSelectedItem()`, `selectItem(id)`, `openSubmenu`, `hasOpenSubmenu()`, `hasSearchQuery()`, `applyValue(id, val)`, `updateValue(id, val)` (`settings-list.ts:253-475`) | `SettingsListAdapter` (`src/ui/settings-list-adapter.ts:38-97`) reads `this.privateFields()` which are `undefined` in OMP: Left/Right arrow throws `TypeError` on `fields.filteredItems[fields.selectedIndex]`, `setSelectedId` no-ops, and `submenuComponent`/`setFocused` return `undefined`. |
| `SettingsList` cursor | `getSettingsListTheme().cursor` is `theme.fg("accent", "→ ")` (`theme.js:1087`) | `getSettingsListTheme().cursor` is `theme.fg("accent", "${theme.nav.cursor} ")` (`"❯ "` in unicode preset, `"> "` uninit; `tui-adapters.ts:361,372`) | Runtime `/advisor-settings` works, but `AdvisorSettingsSelector` can normalize `listTheme.cursor = this.options.theme.fg("accent", "→ ")` (or keep host cursor; normalizing preserves `→` consistency with `SearchableModelList` & `Jev*Submenu`). |
| `Input` cursor in `MaskedInput` | TS `private cursor: number` (`input.js:14`); `new Input()` takes 0 args (`input.d.ts:4`) | ES `#cursor: number` + public `getCursor(): number` (`packages/tui/src/components/input.ts:68,101`) | `src/ui/masked-input.ts:53` reads `(this.input as InputWithCursor).cursor` -> `undefined` in OMP -> `Math.min(undefined, len)` is `NaN` -> `"•".repeat(NaN)` renders `""` (no bullets). Use `getCursor?.()` when present, fallback to `.cursor`. |

## 3. Host Distinction Without `Function.length`

- **Why not `Editor.length`**: fragile under parameter default changes, wrapper functions, and linter rules.
- **Recommended capability checks (no `Function.length`, no unexported root imports)**:
  1. **For `Editor` construction & theme (`src/ui/manual-dialog.ts`)**:
     - Import `getSelectListTheme` from `@earendil-works/pi-coding-agent` (already a verified root export in Pi 1.x `index.d.ts:28` and OMP `legacy-pi-upstream-root-bridges-alias.test.ts:136`).
     - Extract `const symbols = Reflect.get(getSelectListTheme(), "symbols");` (or check `"setTheme" in Editor.prototype`, which is `true` only in OMP `editor.ts:822` and `false` in Pi 1.x `editor.d.ts`).
     - If `"setTheme" in Editor.prototype` (or `symbols !== undefined`): construct `new (Editor as unknown as new (theme: unknown) => Editor)({ ...editorTheme, selectList: { ...editorTheme.selectList, symbols }, symbols })`, then call `editor.setBorderStyle?.("pi"); editor.setPaddingX(0);`.
     - Otherwise (Pi 1.x): call `new Editor(options.tui, editorTheme)`.
  2. **For `SettingsListAdapter` (`src/ui/settings-list-adapter.ts`)**:
     - Use feature detection on public methods first, falling back to Pi 1.x private fields:
     - `submenuComponent`: `"openSubmenu" in this.list ? this.list.openSubmenu?.component ?? null : this.privateFields().submenuComponent`
     - `setSelectedId(items, selectedId)`: `this.list.selectItem(selectedId)` (public in **both** Pi 1.x `settings-list.d.ts:43` and OMP `settings-list.ts:259`! Fallback to `privateFields().selectedIndex` only if needed).
     - `changeWithArrow(keyData, onChange)`:
       - Check active submenu/search via `(typeof this.list.hasOpenSubmenu === "function" ? this.list.hasOpenSubmenu() : Boolean(fields.submenuComponent))` and `(typeof this.list.hasSearchQuery === "function" ? this.list.hasSearchQuery() : Boolean(fields.searchInput?.getValue()))`.
       - Resolve selected item via `typeof this.list.getSelectedItem === "function" ? this.list.getSelectedItem() : fields.filteredItems?.[fields.selectedIndex]`.
       - After computing `nextValue`, update via `this.list.updateValue(item.id, nextValue)` + `item.currentValue = nextValue; onChange(item.id, nextValue)`.
  3. **For `MaskedInput` (`src/ui/masked-input.ts:51-55`)**:
     - Read cursor via `typeof (this.input as { getCursor?: () => number }).getCursor === "function" ? (this.input as { getCursor: () => number }).getCursor() : (this.input as InputWithCursor).cursor`.

## 4. Packaging, Build, Dist & OMP Install Semantics

- **Build & bundle contract (`package.json:27,39,94-99`)**:
  - `main: "dist/index.js"`, `pi.extensions: ["./dist/index.js"]`.
  - `bun run build` bundles `./extensions/index.ts` -> `dist/index.js` (`--target node --format esm --external @earendil-works/pi-ai --external @earendil-works/pi-coding-agent --external @earendil-works/pi-tui --external typebox`).
  - **Crucial**: OMP loads `./dist/index.js` from `package.json#pi.extensions` (`packages/coding-agent/src/extensibility/plugins/loader.ts`). Source edits in `src/**` have **zero effect** in OMP or `test:node-loader` until `bun run build` regenerates `dist/index.js`.
  - **Boundary & package gates**:
    - `scripts/check-module-boundaries.mjs`: production files under `src/` must not import facades (`src/{config,ui,tools,commands}.ts`).
    - `test/facade-exports.test.ts`: pins exact exports of `src/{config,ui,tools,commands}.ts`.
    - `scripts/check-package.mjs`: hardcodes the exact sorted file list from `npm pack --dry-run`. Prefer keeping edits inside existing `src/ui/manual-dialog.ts`, `src/ui/settings-list-adapter.ts`, and `src/ui/masked-input.ts` (0 new files) OR update `expectedFiles` in `scripts/check-package.mjs` if adding a helper file.
    - `tools/oxlint-rules/index.ts`: `no-undeclared-dependencies` forbids importing `@oh-my-pi/*` unless in `package.json`; keep imports on `@earendil-works/*` (which OMP remaps automatically).
- **Verified OMP Install Syntax (`packages/coding-agent/src/cli/classify-install-target.ts`, `commands/install.ts`, `extensibility/plugins/manager.ts`, `git-url.ts`)**:
  - **Prior `git:` syntax is INVALID** (`SHORTHAND_PREFIXES` in `git-url.ts:34-41` only accepts `github:`, `gitlab:`, `bitbucket:`, `codeberg:`, `sourcehut:`, `srht:`, plus `https://`, `ssh://`, `git://`, `git+https://`, `git@`).
  - **Local fork directory (recommended for dev/testing)**:
    - `omp plugin link /home/loidinh/WS/pi-advisor`
    - `omp plugin install /home/loidinh/WS/pi-advisor` (routes to `manager.link()` per `classify-install-target.ts:38-47,91`)
    - `omp install /home/loidinh/WS/pi-advisor` (top-level alias routing local paths to `plugin link` per `commands/install.ts:31-95`)
    - Note: `link()` replaces `~/.omp/plugins/node_modules/pi-advisor-flow` with a symlink to `/home/loidinh/WS/pi-advisor` and updates `~/.omp/plugins/omp-plugins.lock.json`.
  - **Remote Git fork**:
    - `omp plugin install github:loidinhm31/pi-advisor` (or `#<branch-or-sha>`)
    - `omp plugin install https://github.com/loidinhm31/pi-advisor#<branch-or-sha>`
  - **Local tarball (`npm pack`)**:
    - Warning: `omp plugin install ./pi-advisor-flow-0.13.0.tgz` is misclassified as a local directory by `isLocalPathSpec` (`classify-install-target.ts:39`) and passed to `manager.link()`, which fails looking for `./pi-advisor-flow-0.13.0.tgz/package.json` (`manager.ts:897`). Do **not** pass a `.tgz` path to `omp plugin install`; use `omp plugin install /home/loidinh/WS/pi-advisor` (directory link) or `github:loidinhm31/pi-advisor#<ref>`.

## 5. Later Gate Commands (for Implementation Phase)

```bash
# In /home/loidinh/WS/pi-advisor (after `bun install` if node_modules absent):
bun run build
bun test
bun run test:node-loader
bun run typecheck
bun run check:boundaries
bun run lint
bun run format:check
bun run package:check
```

## 6. Unresolved Questions

- None; all TUI constructors, private/public field boundaries, symbol access paths, and OMP plugin install rules are verified from source.
