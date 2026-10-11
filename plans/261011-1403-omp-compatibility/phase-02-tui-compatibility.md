# Phase 02: TUI Compatibility (Manual Dialog, Settings Adapter & Masked Input)

## Context Links

- [Overview Plan](plan.md)
- [Design Decisions & Phase Contracts](research/design-decisions.md)
- [TUI & Packaging Research](research/tui-packaging-research.md)
- [Requirement and Verification Matrix](reports/acceptance-matrix.md) (`T1`–`T5`)
- [Pi Extension Docs](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)
- [Phase 01 — Host Contracts](phase-01-host-contracts.md)
- [Phase 03 — Prompt Injection](phase-03-prompt-injection.md)

## Overview

- **Date**: 2026-10-11
- **Priority**: P2
- **Implementation Status**: DONE (100% — 2026-10-11)
- **Review Status**: Approved (10/10 — 2026-10-11)
- **Owner**: TUI owner
- **Depends On**: [Phase 01 — Host Contracts](phase-01-host-contracts.md) (runs in parallel with Phase 03; disjoint from `src/tools/*`)
- **Scope**: Fix `/advisor-manual` overlay crash and nested border chrome in OMP, migrate `SettingsListAdapter` to public methods first with Pi 1.x fallback, and fix `MaskedInput` cursor detection so secret inputs render bullets in both hosts.

## Key Insights

- `ManualAdvisorDialog` (`src/ui/manual-dialog.ts`) calls `new Editor(options.tui, editorTheme)`. In OMP (`@oh-my-pi/pi-tui` `Editor`), constructor takes `new Editor(theme: EditorTheme)`, binding `options.tui` to `#theme` and throwing `TypeError` when `Editor` or its nested `SelectList` accesses `this.#theme.symbols` (cite symbols first; re-verify OMP lines at implementation kickoff due to working-tree drift).
- `getSelectListTheme()` is a root export of `@earendil-works/pi-coding-agent` in both Pi 1.x and OMP; in OMP (`packages/tui/src/theme/tui-adapters.ts`) it carries a complete `SymbolTheme` object on `.symbols` (`cursor`, `inputCursor`, `boxRound`, `boxSharp`, `table`, `quoteBorder`, `hrChar`, `colorSwatch`, `spinnerFrames`) with safe ASCII fallbacks even before `initTheme()`. Static-importing `getSymbolTheme` would break Pi 1.x `tsc` and Node ESM loading.
- OMP `Editor` defaults to `#borderStyle = "box"` (`paddingX = 2`), which nests a second box inside `ManualAdvisorDialog`. Calling `editor.setBorderStyle?.("pi")` and `editor.setPaddingX?.(0)` in OMP aligns horizontal rule framing with Pi 1.x while preserving host cursor glyphs.
- `SettingsListAdapter` (`src/ui/settings-list-adapter.ts`) reads TS `private` fields (`filteredItems`, `selectedIndex`, `searchInput`, `submenuComponent`) that are ES `#private` in OMP (`SettingsList`), breaking Left/Right arrow changes, selection restoration, and submenu focus.
- `MaskedInput` (`src/ui/masked-input.ts`) reads `(this.input as InputWithCursor).cursor`, which is `undefined` in OMP (`Input` `#cursor` is private, `getCursor()` is public), producing `Math.min(undefined, len) === NaN` and hiding bullets.

## Requirements

### Functional Requirements

1. Construct `Editor` in `ManualAdvisorDialog` using Phase 01's capability check (`"setTheme" in Editor.prototype` + complete `HostSymbolTheme` validated from `Reflect.get(getSelectListTheme(), "symbols")`), never `Editor.length`.
2. Pass the complete validated `HostSymbolTheme` object to **both** `editorTheme.symbols` and `editorTheme.selectList.symbols` so `Editor` and nested `SelectList` autocomplete receive every required symbol (`cursor`, `inputCursor`, `boxRound`, `boxSharp`, `table`, `quoteBorder`, `hrChar`, `spinnerFrames`). Throw a clear diagnostic `Error` before constructing the overlay if `"setTheme" in Editor.prototype` is true but `isHostSymbolTheme(symbols)` is false.
3. Configure OMP `Editor` with `setBorderStyle?.("pi")` and `setPaddingX?.(0)` while respecting active host cursor/border symbols (do not normalize cursor glyphs for cosmetic parity).
4. Update `SettingsListAdapter` against Phase 01's `SettingsListPublicAdapterContract` (`getSelectedItem`, `selectItem`, `hasOpenSubmenu`, `hasSearchQuery`, `openSubmenu`, `updateValue`) so that every public-method branch **returns immediately** before touching `privateFields()`, falling back to `privateFields()` only for Pi 1.x.
5. Update `MaskedInput` against `InputCursorAdapterContract` to read cursor position via `input.getCursor()` when available and return the clamped integer `[0, value.length]` before falling back to `input.cursor` for Pi 1.x.

### Non-Functional Requirements

- Read [Pi extension docs](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md) before UI edits. Do not touch `src/tools/*` or `src/commands/*` (owned by Phases 03 and 04); no git commits unless requested; no broad cleanup.
- Keep internal helpers (`createManualDialogEditor`, `isHostSymbolTheme`, `hasSettingsListPublicContract`, `resolveInputCursor`) private to their owning leaf modules unless genuinely imported by another leaf; never export them from `src/ui.ts` (`test/facade-exports.test.ts`).
- Respect `/home/loidinh/WS/pi-advisor/AGENTS.md`: single-line comments only when 100% needed; preserve public and unknown `advisor.json` fields when `/advisor-settings` saves; visually verify manual call box, streaming state, response renderer, error, and blocked state in reloaded TUI.
- Forbid `any`, `ReturnType`, mock-double self-tests, bare private-property `undefined` assertions, and source-text regex tests. Verify against real Pi 1.x and real OMP TUI components in isolated processes (`test/helpers/dual-host-harness.ts`) plus real PTY TUI smoke.

## Architecture

### 1. Checked `Editor` Construction Algorithm (`src/ui/manual-dialog.ts`)

- Keep `createManualDialogEditor`, `isHostSymbolTheme`, and `HostConfigurableEditor` module-private inside `src/ui/manual-dialog.ts`; consume `HostSymbolTheme` from `src/ui/types.ts`.
  1. Check `"setTheme" in Editor.prototype`. If `false` (Pi 1.x), construct and **return** `new Editor(options.tui, editorTheme)`.
  2. Call `getSelectListTheme()` (imported from `@earendil-works/pi-coding-agent`) and read `const symbols = Reflect.get(selectListTheme, "symbols")`.
  3. Validate `isHostSymbolTheme(symbols)`: verify non-null object with string `cursor`, `inputCursor`, `quoteBorder`, `hrChar`, string-array `spinnerFrames`, 6-key string record `boxRound` (`topLeft`, `topRight`, `bottomLeft`, `bottomRight`, `horizontal`, `vertical`), and 11-key string records `boxSharp` and `table` (the 6 keys plus `teeDown`, `teeUp`, `teeLeft`, `teeRight`, `cross`).
  4. If `isHostSymbolTheme(symbols)` is `false`, throw `new Error("Incompatible host Editor capability: OMP Editor requires a complete SymbolTheme from getSelectListTheme().")` before constructing the dialog.
  5. Build the OMP editor theme by attaching the **complete validated `symbols` object** to both `selectList: { ...editorTheme.selectList, symbols }` and top-level `symbols`.
  6. Construct the 1-arg OMP `Editor(ompTheme)`, invoke `setBorderStyle?.("pi")` and `setPaddingX?.(0)` via `HostConfigurableEditor`, and **return** the editor instance.

### 2. Public-Method-First `SettingsListAdapter` Contract (`src/ui/settings-list-adapter.ts`)

- Keep `hasSettingsListPublicContract(list): list is SettingsList & SettingsListPublicAdapterContract` private inside `src/ui/settings-list-adapter.ts`, checking that `getSelectedItem`, `hasOpenSubmenu`, `hasSearchQuery`, `selectItem`, and `updateValue` are functions on `list`.
- In every adapter method, **return immediately** from the public-method branch when `hasSettingsListPublicContract(this.list)` is `true` so `this.privateFields()` is never called on OMP `SettingsList`:
  1. `get submenuComponent()`:
     - If `hasSettingsListPublicContract(this.list)`: **return** `this.list.openSubmenu?.component ?? null`.
     - Fallback (Pi 1.x): **return** `this.privateFields().submenuComponent`.
  2. `setFocused(value: boolean)`:
     - If `hasSettingsListPublicContract(this.list)`: read `const submenu = this.list.openSubmenu?.component as Focusable | undefined`, set `if (submenu) submenu.focused = value`, and **return**.
     - Fallback (Pi 1.x): read `const submenu = this.privateFields().submenuComponent as Focusable | undefined` and set `if (submenu) submenu.focused = value`.
  3. `setSelectedId(items: SettingItem[], selectedId: string)`:
     - If `hasSettingsListPublicContract(this.list)`: call `this.list.selectItem(selectedId)` and **return** immediately (do not fall through to `this.privateFields()`).
     - Fallback (Pi 1.x): find `selectedIndex = items.findIndex((item) => item.id === selectedId)` and, when `selectedIndex !== -1`, assign `this.privateFields().selectedIndex = selectedIndex`.
  4. `changeWithArrow(keyData: string, onChange: (id: string, value: string) => void)`:
     - Compute `direction` (`-1` for Left, `1` for Right; otherwise **return `false`**).
     - If `hasSettingsListPublicContract(this.list)`:
       - If `this.list.hasOpenSubmenu() || this.list.hasSearchQuery()`, **return `false`**.
       - Read `const item = this.list.getSelectedItem()`. If `!item?.values?.length`, **return `false`**.
       - Compute cyclic `nextValue` from `item.values` and `item.currentValue`. If `nextValue === undefined`, **return `false`**.
       - Call `this.list.updateValue(item.id, nextValue)`, set `item.currentValue = nextValue`, invoke `onChange(item.id, nextValue)`, and **return `true`**.
     - Fallback (Pi 1.x): read `this.privateFields()`, guard on `fields.submenuComponent || fields.searchInput?.getValue()`, resolve `fields.filteredItems[fields.selectedIndex]`, cycle `item.values`, set `item.currentValue = nextValue`, invoke `onChange(item.id, nextValue)`, and **return `true`**.

### 3. `MaskedInput` Cursor Resolution Algorithm (`src/ui/masked-input.ts`)

- Keep `resolveInputCursor(input, valueLength)` private inside `src/ui/masked-input.ts` using `InputCursorAdapterContract`:
  1. If `typeof input.getCursor === "function"`, read `rawCursor = input.getCursor()` and **return** `Number.isFinite(rawCursor) ? Math.max(0, Math.min(Math.trunc(rawCursor), valueLength)) : valueLength`.
  2. Otherwise (Pi 1.x fallback), read `rawCursor = input.cursor` and **return** `Number.isFinite(rawCursor) ? Math.max(0, Math.min(Math.trunc(rawCursor), valueLength)) : valueLength`.

## Related Code Files

| File Path | Action | Role / Ownership |
| --- | --- | --- |
| `/home/loidinh/WS/pi-advisor/src/ui/manual-dialog.ts` | Modify | Add private `isHostSymbolTheme` and `createManualDialogEditor` using complete `HostSymbolTheme` and `"pi"` border style |
| `/home/loidinh/WS/pi-advisor/src/ui/settings-list-adapter.ts` | Modify | Implement `SettingsListPublicAdapterContract` branch with early `return` before `privateFields()` fallback |
| `/home/loidinh/WS/pi-advisor/src/ui/masked-input.ts` | Modify | Implement private `resolveInputCursor` preferring `getCursor()` with finite `[0, value.length]` clamping |
| `/home/loidinh/WS/pi-advisor/test/ui.test.ts` | Modify | Add real Pi 1.x and isolated-process real OMP `ManualAdvisorDialog`, `SettingsListAdapter`, and `MaskedInput` boundary tests |
| `/home/loidinh/WS/pi-advisor/test/manual-dialog.test.ts` | Modify | Verify `/advisor-manual` overlay open, edit, Git context selection, cancel, and submit across both hosts |
| `/home/loidinh/WS/pi-advisor/test/settings-navigation.test.ts` | Modify | Verify `/advisor-settings` arrow cycling, `Simple mode` toggle rebuild, and search/submenu guards across both hosts |

## Implementation Steps

1. **Update `/home/loidinh/WS/pi-advisor/src/ui/manual-dialog.ts`**:
   - Import `getSelectListTheme` from `@earendil-works/pi-coding-agent` and `HostSymbolTheme` from `./types.ts`; declare `HostConfigurableEditor` locally.
   - Implement private `isHostSymbolTheme` and `createManualDialogEditor`, attaching the complete validated `HostSymbolTheme` to both `editorTheme.symbols` and `editorTheme.selectList.symbols` when `"setTheme" in Editor.prototype` is true.
2. **Update `/home/loidinh/WS/pi-advisor/src/ui/settings-list-adapter.ts`**:
   - Implement `hasSettingsListPublicContract` against `SettingsListPublicAdapterContract` from `./types.ts`.
   - Ensure `submenuComponent`, `setFocused`, `setSelectedId`, and `changeWithArrow` return directly from the public-method branch before `this.privateFields()`.
3. **Update `/home/loidinh/WS/pi-advisor/src/ui/masked-input.ts`**:
   - Implement private `resolveInputCursor` preferring `getCursor()` with `[0, value.length]` clamping before `.cursor` fallback.
4. **Add Real Dual-Host Boundary Tests (`test/ui.test.ts`, `test/manual-dialog.test.ts`, `test/settings-navigation.test.ts`)**:
   - Exercise `ManualAdvisorDialog`, `AdvisorSettingsSelector` / `SettingsListAdapter`, and `MaskedInput` against real Pi 1.x TUI components in-process and against real `@oh-my-pi/pi-tui` components in an isolated OMP child process via `test/helpers/dual-host-harness.ts`.

## Todo List

- [x] Implement private `isHostSymbolTheme` and `createManualDialogEditor` in `/home/loidinh/WS/pi-advisor/src/ui/manual-dialog.ts`
- [x] Update `/home/loidinh/WS/pi-advisor/src/ui/settings-list-adapter.ts` so every public-method branch returns before `privateFields()`
- [x] Update `/home/loidinh/WS/pi-advisor/src/ui/masked-input.ts` to prefer `getCursor()` with finite clamping
- [x] Add real Pi 1.x and isolated real OMP TUI boundary tests in `test/ui.test.ts`, `test/manual-dialog.test.ts`, and `test/settings-navigation.test.ts`

## Success Criteria

- **Future implementation verification gates (`reports/acceptance-matrix.md` `T1`–`T5`; not claimed complete during planning)**:
  1. `T1`/`T2`/`T3`: In both Pi 1.x and an isolated real OMP subprocess (`@oh-my-pi/pi-tui` `Editor` + `getSelectListTheme()`), `ManualAdvisorDialog` renders bounded lines (`visibleWidth(line) <= width`), edits prefilled focus, moves focus across Editor/Git/Actions on Up/Down/Tab, cancels cleanly on Escape with zero requests/budget use, and submits `{ message, gitContext }` once on Enter.
  2. `T1` diagnostic: When `"setTheme" in Editor.prototype` is true but `getSelectListTheme().symbols` is missing required `HostSymbolTheme` fields (including `selectList.symbols` fields), construction throws `"Incompatible host Editor capability: OMP Editor requires a complete SymbolTheme from getSelectListTheme()."` before opening a broken overlay.
  3. `T4`: Wrapping a real OMP `SettingsList` in `SettingsListAdapter` cycles setting values on Left/Right arrow, updates `item.currentValue` and `updateValue`, preserves selected row across `Simple mode` `On` ↔ `Off` list rebuilds via `selectItem`, blocks arrow changes when `hasOpenSubmenu()` or `hasSearchQuery()` is true, and returns before touching `privateFields()`.
  4. `T5`: A real OMP `Input` wrapped in `MaskedInput` keeps the caret at the edited position across cursor moves/paste, masks all secret text, and renders within the available width using the active host's cursor glyph. Do not pin a literal glyph or require visible content at zero width.
  5. Focused Phase 02 verification commands and real OMP TUI smoke pass:
     ```bash
     bun --cwd /home/loidinh/WS/pi-advisor run build
     bun --cwd /home/loidinh/WS/pi-advisor test test/ui.test.ts test/manual-dialog.test.ts test/settings-navigation.test.ts test/facade-exports.test.ts
     bun --cwd /home/loidinh/WS/pi-advisor run typecheck
     bun --cwd /home/loidinh/WS/pi-advisor run check:boundaries
     ```
     Plus headless real-PTY (`xd://tui`) smoke in OMP opening `/advisor-manual` and `/advisor-settings` to visually verify call/stream/result/error/blocked states.

## Risk Assessment

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Public-method branch in `SettingsListAdapter` falls through into `privateFields()` | High | Enforce explicit early `return` in every `hasSettingsListPublicContract(this.list)` branch. |
| Incomplete `symbols` object breaks nested `SelectList` inside OMP `Editor` | High | Validate the complete `HostSymbolTheme` object from `getSelectListTheme().symbols` and assign it to both `editorTheme.symbols` and `editorTheme.selectList.symbols`. |
| Cosmetic cursor differences between Pi and OMP | Low | Assert bounded width, masked bullets, and functional navigation/submission rather than hardcoded host cursor glyphs. |

## Security Considerations

- `MaskedInput` handles API keys in Jev provider setup (`src/ui/jev-provider-submenu.ts`); clamping cursor to `[0, value.length]` guarantees secrets remain masked as `•` and never expose raw key text in terminal output.

## Next Steps

- Merge with **Phase 03** (`phase-03-prompt-injection.md`) once both complete; parent runs focused TUI and prompt verification gates before **Phase 05** (`phase-05-full-gate-settings.md`).

## Unresolved Questions

- None. Real-host TUI and visual smoke checks remain future implementation gates.
