import { getSelectListTheme } from "@earendil-works/pi-coding-agent";
import { Editor, Key, matchesKey } from "@earendil-works/pi-tui";
import type {
  Component,
  EditorTheme,
  Focusable,
  Keybindings,
  KeyId,
  TUI,
} from "@earendil-works/pi-tui";

import { isRecordOf, isString } from "../content-utils.ts";
import { clampGitContextLevel, GIT_CONTEXT_LEVELS } from "../git.ts";
import type { GitContextLevel } from "../git.ts";
import { renderManualAdvisorDialog } from "./manual-dialog-render.ts";
import type {
  HostBoxSymbols,
  HostRoundedBoxSymbols,
  HostSymbolTheme,
  ManualAdvisorDialogOptions,
  ManualAdvisorFocus,
  ManualAdvisorRequest,
} from "./types.ts";

// SAFETY: the joined literal is exactly the registered "tui.input.tab" keybinding path.
const TUI_INPUT_TAB: keyof Keybindings = ["tui", "input", "tab"].join(
  "."
) as keyof Keybindings;

interface ManualDialogState {
  completed: boolean;
  focused: boolean;
  submitting: boolean;
}

const isShiftTab = (keyData: string): boolean =>
  matchesKey(keyData, Key.shift("tab"));

interface HostConfigurableEditor extends Editor {
  setBorderStyle?: (style: "box" | "pi") => void;
  setTheme?: (theme: EditorTheme) => void;
}

interface HostSelectListTheme {
  symbols?: HostSymbolTheme;
}

const ROUND_BOX_KEYS: (keyof HostRoundedBoxSymbols)[] = [
  "bottomLeft",
  "bottomRight",
  "horizontal",
  "topLeft",
  "topRight",
  "vertical",
];

const SHARP_BOX_KEYS: (keyof HostBoxSymbols)[] = [
  ...ROUND_BOX_KEYS,
  "cross",
  "teeDown",
  "teeLeft",
  "teeRight",
  "teeUp",
];

const hasNonEmptyStringKeys = <Value>(
  value: Value,
  keys: readonly string[]
): boolean => {
  if (!isRecordOf(value)) {
    return false;
  }
  return keys.every((key) => {
    const entry = value[key];
    return isString(entry) && entry.length > 0;
  });
};

const isHostSymbolTheme = <Value>(
  candidate: Value
): candidate is Value & HostSymbolTheme => {
  if (!isRecordOf(candidate)) {
    return false;
  }
  const { boxRound, boxSharp, colorSwatch, spinnerFrames, table } = candidate;
  if (colorSwatch !== undefined && !isString(colorSwatch)) {
    return false;
  }
  if (
    !Array.isArray(spinnerFrames) ||
    spinnerFrames.length === 0 ||
    !spinnerFrames.every((frame) => isString(frame) && frame.length > 0)
  ) {
    return false;
  }
  return (
    hasNonEmptyStringKeys(candidate, [
      "cursor",
      "hrChar",
      "inputCursor",
      "quoteBorder",
    ]) &&
    hasNonEmptyStringKeys(boxRound, ROUND_BOX_KEYS) &&
    hasNonEmptyStringKeys(boxSharp, SHARP_BOX_KEYS) &&
    hasNonEmptyStringKeys(table, SHARP_BOX_KEYS)
  );
};

const hasOmpEditorCapability = (
  prototype: Editor
): prototype is HostConfigurableEditor => {
  // SAFETY: Editor.prototype is a non-null object; narrowing checks whether OMP's setTheme method is callable.
  const candidate = prototype as HostConfigurableEditor;
  return "setTheme" in prototype && typeof candidate.setTheme === "function";
};

const createManualDialogEditor = (
  tui: TUI,
  editorTheme: EditorTheme
): Editor => {
  if (!hasOmpEditorCapability(Editor.prototype)) {
    return new Editor(tui, editorTheme);
  }
  // SAFETY: OMP attaches its runtime SymbolTheme to the returned SelectListTheme object.
  const { symbols } = getSelectListTheme() as HostSelectListTheme;
  if (!isHostSymbolTheme(symbols)) {
    throw new Error(
      "Incompatible host Editor capability: OMP Editor requires a complete SymbolTheme from getSelectListTheme()."
    );
  }
  const ompTheme = {
    ...editorTheme,
    selectList: { ...editorTheme.selectList, symbols },
    symbols,
  };
  // SAFETY: "setTheme" in Editor.prototype selects OMP's 1-arg Editor(theme) constructor.
  const editor = Reflect.construct(Editor, [
    ompTheme,
  ]) as HostConfigurableEditor;
  editor.setBorderStyle?.("pi");
  editor.setPaddingX?.(0);
  return editor;
};

/** The small, non-persistent /advisor-manual form; callers own budget and consultation decisions. */
export class ManualAdvisorDialog implements Component, Focusable {
  private readonly options: ManualAdvisorDialogOptions;
  private readonly editor: Editor;
  private readonly gitLevels: GitContextLevel[];
  private gitIndex: number;
  private actionIndex = 0;
  private focusTarget: ManualAdvisorFocus = "editor";
  private readonly state: ManualDialogState = {
    completed: false,
    focused: false,
    submitting: false,
  };

  get focused(): boolean {
    return this.state.focused;
  }

  set focused(value: boolean) {
    this.state.focused = value;
    this.updateEditorFocus();
    this.options.tui.requestRender();
  }

  constructor(options: ManualAdvisorDialogOptions) {
    this.options = options;
    // Show the configured default first, followed by progressively narrower
    // choices. That makes Down do the useful thing from the initial selection
    // while the configured level remains the hard ceiling.
    this.gitLevels = GIT_CONTEXT_LEVELS.filter(
      (level) => clampGitContextLevel(level, options.gitContext) === level
    ).toReversed();
    this.gitIndex = Math.max(0, this.gitLevels.indexOf(options.gitContext));

    const editorTheme: EditorTheme = {
      borderColor: (text) => options.theme.fg("border", text),
      selectList: {
        description: (text) => options.theme.fg("muted", text),
        noMatch: (text) => options.theme.fg("warning", text),
        scrollInfo: (text) => options.theme.fg("dim", text),
        selectedPrefix: (text) => options.theme.fg("accent", text),
        selectedText: (text) => options.theme.fg("accent", text),
      },
    };
    this.editor = createManualDialogEditor(options.tui, editorTheme);
    this.editor.setText(options.initialMessage ?? "");
    this.editor.onChange = () => options.tui.requestRender();
    this.editor.onSubmit = (message) => this.submit(message);
    this.updateEditorFocus();
  }

  invalidate(): void {
    this.editor.invalidate();
  }

  dispose(): void {
    this.state.completed = true;
  }

  handleInput(keyData: string): void {
    if (this.state.completed) {
      return;
    }
    if (this.isCancel(keyData)) {
      this.cancel();
      return;
    }
    if (isShiftTab(keyData)) {
      this.changeFocus(-1);
      return;
    }
    if (this.isTab(keyData)) {
      this.changeFocus(1);
      return;
    }
    const handlers: Record<ManualAdvisorFocus, (keyData: string) => void> = {
      actions: (key) => this.handleActionInput(key),
      editor: (key) => this.handleEditorInput(key),
      git: (key) => this.handleGitInput(key),
    };
    handlers[this.focusTarget](keyData);
  }

  render(width: number): string[] {
    const renderWidth = Math.max(1, Math.floor(width));
    const innerWidth = Math.max(0, renderWidth - 2);
    const horizontalPadding = renderWidth >= 4 ? 1 : 0;
    const contentWidth = Math.max(0, innerWidth - horizontalPadding * 2);
    return renderManualAdvisorDialog({
      actionIndex: this.actionIndex,
      editorLines: this.editor.render(Math.max(1, contentWidth)),
      focusTarget: this.focusTarget,
      gitContext: this.options.gitContext,
      gitIndex: this.gitIndex,
      gitLevels: this.gitLevels,
      horizontalPadding,
      renderWidth,
      theme: this.options.theme,
    });
  }

  private handleEditorInput(keyData: string): void {
    // Editor owns Enter/Shift+Enter and all cursor/editing semantics. Its
    // onSubmit callback above is the sole editor submission path. At the
    // edge of the message, a directional key also moves to the adjacent
    // form control so the Git selector is reachable without Tab.
    let direction: -1 | 1 | undefined;
    if (this.matches(keyData, "tui.editor.cursorDown", Key.down)) {
      direction = 1;
    } else if (this.matches(keyData, "tui.editor.cursorUp", Key.up)) {
      direction = -1;
    }

    const beforeCursor =
      direction === undefined ? undefined : this.editor.getCursor();
    const beforeText =
      direction === undefined ? undefined : this.editor.getText();
    this.editor.handleInput(keyData);

    if (direction !== undefined) {
      const afterCursor = this.editor.getCursor();
      if (
        beforeCursor?.line === afterCursor.line &&
        beforeCursor.col === afterCursor.col &&
        beforeText === this.editor.getText()
      ) {
        this.changeFocus(direction);
        return;
      }
    }
    this.options.tui.requestRender();
  }

  private handleGitInput(keyData: string): void {
    // Accept both the selector bindings and the editor arrow bindings. The
    // latter keeps the form usable with user keymaps that customize selector
    // actions, while the raw-key fallback keeps terminal arrow sequences
    // working across Pi/pi-tui versions.
    const up =
      this.matches(keyData, "tui.select.up", Key.up) ||
      this.matches(keyData, "tui.editor.cursorUp", Key.up);
    const down =
      this.matches(keyData, "tui.select.down", Key.down) ||
      this.matches(keyData, "tui.editor.cursorDown", Key.down);
    if (up) {
      if (this.gitIndex === 0) {
        this.changeFocus(-1);
      } else {
        this.moveGit(-1);
      }
      return;
    }
    if (down) {
      if (this.gitIndex === this.gitLevels.length - 1) {
        this.changeFocus(1);
      } else {
        this.moveGit(1);
      }
      return;
    }
    if (matchesKey(keyData, Key.space)) {
      this.moveGit(1);
      return;
    }
    if (this.matches(keyData, "tui.input.submit", Key.enter)) {
      this.changeFocus(1);
      return;
    }
    this.options.tui.requestRender();
  }

  private handleActionInput(keyData: string): void {
    if (this.matches(keyData, "tui.editor.cursorUp", Key.up)) {
      this.changeFocus(-1);
      return;
    }
    if (this.matches(keyData, "tui.editor.cursorDown", Key.down)) {
      this.changeFocus(1);
      return;
    }
    if (matchesKey(keyData, Key.left) || matchesKey(keyData, Key.right)) {
      this.actionIndex = this.actionIndex === 0 ? 1 : 0;
      this.options.tui.requestRender();
      return;
    }
    if (
      this.matches(keyData, "tui.input.submit", Key.enter) ||
      matchesKey(keyData, Key.space)
    ) {
      if (this.actionIndex === 0) {
        this.submit();
      } else {
        this.cancel();
      }
    }
  }

  private changeFocus(direction: -1 | 1): void {
    const targets: ManualAdvisorFocus[] = ["editor", "git", "actions"];
    const current = targets.indexOf(this.focusTarget);
    this.focusTarget =
      targets[(current + direction + targets.length) % targets.length];
    this.updateEditorFocus();
    this.options.tui.requestRender();
  }

  private moveGit(direction: -1 | 1): void {
    if (this.gitLevels.length > 0) {
      this.gitIndex =
        (this.gitIndex + direction + this.gitLevels.length) %
        this.gitLevels.length;
    }
    this.options.tui.requestRender();
  }

  private updateEditorFocus(): void {
    this.editor.focused = this.state.focused && this.focusTarget === "editor";
  }

  private isTab(keyData: string): boolean {
    return (
      this.matches(keyData, TUI_INPUT_TAB, Key.tab) &&
      !matchesKey(keyData, Key.shift("tab"))
    );
  }

  private isCancel(keyData: string): boolean {
    return (
      matchesKey(keyData, Key.escape) ||
      this.options.keybindings.matches(keyData, "tui.select.cancel")
    );
  }

  private matches(
    keyData: string,
    action: keyof Keybindings,
    fallback: KeyId
  ): boolean {
    return (
      this.options.keybindings.matches(keyData, action) ||
      matchesKey(keyData, fallback)
    );
  }

  private submit(message = this.editor.getText()): void {
    if (this.state.completed || this.state.submitting) {
      return;
    }
    this.state.submitting = true;
    const request: ManualAdvisorRequest = {
      gitContext: this.gitLevels[this.gitIndex] ?? "off",
    };
    if (message) {
      request.message = message;
    }
    try {
      this.options.onSubmit(request);
      this.state.completed = true;
    } finally {
      this.state.submitting = false;
    }
  }

  private cancel(): void {
    if (this.state.completed) {
      return;
    }
    this.state.completed = true;
    this.options.onCancel();
  }
}
