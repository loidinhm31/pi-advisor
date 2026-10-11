import { describe, expect, test } from "bun:test";
import { join, resolve as resolvePath } from "node:path";

import { initTheme } from "@earendil-works/pi-coding-agent";
import {
  Editor,
  getKeybindings,
  Input,
  Key,
  matchesKey,
  stripTerminalSequences,
  visibleWidth,
} from "@earendil-works/pi-tui";
import type { TUI } from "@earendil-works/pi-tui";

import {
  AdvisorSettingsSelector,
  ManualAdvisorDialog,
  SearchableModelSelector,
} from "../src/ui.ts";
import type { ManualAdvisorRequest } from "../src/ui.ts";
import { MaskedInput } from "../src/ui/masked-input.ts";
import { TextSettingSubmenu } from "../src/ui/text-setting-submenu.ts";
import {
  hasSettingsListPublicContract,
  isHostSymbolTheme,
  runOmpHostProbe,
  runOmpScript,
} from "./helpers/dual-host-harness.ts";
import { plainThemeMock } from "./helpers/theme.ts";

initTheme();

const theme = plainThemeMock;

interface AnsiCodeTable {
  accent: number;
  border: number;
  dim: number;
  muted: number;
  text: number;
  [color: string]: number;
}

const actionsRow = (lines: string[]) =>
  lines
    .map((line) => stripTerminalSequences(line))
    .find((line) => line.includes("[Submit]"));

const makeModelSelector = (
  allOptions: string[],
  currentOption?: string,
  testTheme: any = theme
) => {
  let selected: string | undefined;
  const selector = new SearchableModelSelector({
    allOptions,
    currentOption,
    // SAFETY: keybindings mock only answers matches(), the sole method the selector calls.
    keybindings: { matches: () => false } as any,
    onCancel: () => {},
    onSelect: (value) => {
      selected = value;
    },
    theme: testTheme,
    title: "Select Model",
    tui: { requestRender: () => {} },
  });
  return { selected: () => selected, selector };
};

const makeTui = () => {
  let renders = 0;
  // SAFETY: mock implements requestRender and terminal.rows, the members the dialog under test reads.
  const tui = {
    requestRender: () => {
      renders += 1;
    },
    terminal: { rows: 24 },
  } as TUI;
  return { renders: () => renders, tui };
};

const makeDialog = ({
  initialMessage,
  gitContext = "summary",
}: {
  initialMessage?: string;
  gitContext?: "off" | "summary" | "full";
} = {}) => {
  const submitted: ManualAdvisorRequest[] = [];
  let cancelled = 0;
  const { tui, renders } = makeTui();
  const dialog = new ManualAdvisorDialog({
    gitContext,
    initialMessage,
    keybindings: getKeybindings(),
    onCancel: () => {
      cancelled += 1;
    },
    onSubmit: (request) => {
      submitted.push(request);
    },
    theme,
    tui,
  });
  dialog.focused = true;
  return { cancelled: () => cancelled, dialog, renders, submitted };
};

describe("ManualAdvisorDialog", () => {
  test("renders the prefilled message, context explanation, choices, and actions", () => {
    const { dialog } = makeDialog({
      gitContext: "full",
      initialMessage: "Check the migration",
    });
    const screen = stripTerminalSequences(dialog.render(90).join("\n"))
      .replaceAll(/[│]/gu, " ")
      .replaceAll(/\s+/gu, " ");

    expect(screen).toContain("Ask Advisor");
    expect(screen).toContain("▸ Message for Advisor (optional)");
    expect(screen).toContain("Check the migration");
    expect(screen).toContain("Automatic context follows your settings");
    expect(screen).toContain("conversation history");
    expect(screen).toContain("tool disclosure");
    expect(screen).toContain("project preferences");
    expect(screen).toContain("redaction");
    expect(screen).toContain("configured limits");
    expect(screen).toContain("does not expose drafts");
    expect(screen).toContain("does not remove configured conversation history");
    expect(screen).toContain("○ Summary — changed paths and status");
    expect(screen).toContain("○ None — no Git data");
    expect(screen).toContain("● Full — summary plus patch");
    expect(screen).toContain("max: Full");
    expect(screen).toContain("[Submit]");
    expect(screen).toContain("[Cancel]");
    expect(screen).toContain("Shift+Enter newline");
  });

  test("selects the configured Git default and hides choices above its ceiling", () => {
    const summary = makeDialog({ gitContext: "summary" })
      .dialog.render(90)
      .join("\n");
    expect(summary).toContain("● Summary");
    expect(summary).not.toContain("Full — summary plus patch");

    const off = makeDialog({ gitContext: "off" }).dialog.render(90).join("\n");
    expect(off).toContain("● None — no Git data");
    expect(off).not.toContain("Summary — changed paths and status");
    expect(off).not.toContain("Full — summary plus patch");
  });

  test("uses the real Enter and Shift+Enter sequences for submit and multiline editing", () => {
    const { dialog, submitted } = makeDialog({ initialMessage: "First" });

    expect(matchesKey("\r", Key.enter)).toBe(true);
    expect(matchesKey("\n", Key.shift("enter"))).toBe(false);
    dialog.handleInput("\n");
    for (const character of "Second") {
      dialog.handleInput(character);
    }

    expect(submitted).toHaveLength(0);
    dialog.handleInput("\r");
    expect(submitted).toEqual([
      { gitContext: "summary", message: "First\nSecond" },
    ]);
  });

  test("blank submission returns an optional empty message and normalizes once", () => {
    const { dialog, submitted, cancelled } = makeDialog();

    dialog.handleInput("\r");
    dialog.handleInput("\r");
    dialog.handleInput("\u001B");

    expect(submitted).toEqual([{ gitContext: "summary" }]);
    expect(cancelled()).toBe(0);
  });

  test("cycles focus, changes Git/action selection, and submits or cancels the selected action", () => {
    const { dialog, submitted, cancelled } = makeDialog({ gitContext: "full" });

    dialog.handleInput("\t");
    dialog.handleInput("\u001B[B");
    dialog.handleInput("\t");
    dialog.handleInput("\u001B[C");
    dialog.handleInput("\r");

    expect(submitted).toEqual([]);
    expect(cancelled()).toBe(1);

    const second = makeDialog({ gitContext: "full" });
    second.dialog.handleInput("\t");
    second.dialog.handleInput("\t");
    second.dialog.handleInput("\r");
    expect(second.submitted).toEqual([{ gitContext: "full" }]);
  });

  test("uses arrows and Space within Git choices, then leaves at the edges", () => {
    const summary = makeDialog({ gitContext: "summary" });
    summary.dialog.handleInput("\u001B[B");
    expect(
      stripTerminalSequences(summary.dialog.render(90).join("\n"))
    ).toContain("▸ ● Summary — changed paths and status");
    summary.dialog.handleInput("\u001B[B");
    expect(
      stripTerminalSequences(summary.dialog.render(90).join("\n"))
    ).toContain("▸ ● None — no Git data");
    summary.dialog.handleInput(" ");
    expect(
      stripTerminalSequences(summary.dialog.render(90).join("\n"))
    ).toContain("● Summary");

    const git = makeDialog({ gitContext: "full" });
    git.dialog.handleInput("\u001B[B");
    git.dialog.handleInput("\u001B[B");
    expect(stripTerminalSequences(git.dialog.render(90).join("\n"))).toContain(
      "● Summary — changed paths and status"
    );
    git.dialog.handleInput("\u001B[A");
    expect(stripTerminalSequences(git.dialog.render(90).join("\n"))).toContain(
      "● Full — summary plus patch"
    );

    const editor = makeDialog({ gitContext: "off" });
    editor.dialog.handleInput("\u001B[B");
    editor.dialog.handleInput("\u001B[A");
    editor.dialog.handleInput("x");
    expect(
      stripTerminalSequences(editor.dialog.render(90).join("\n"))
    ).toContain("│ x");

    const actions = makeDialog({ gitContext: "full" });
    actions.dialog.handleInput("\u001B[B");
    actions.dialog.handleInput("\u001B[B");
    actions.dialog.handleInput("\u001B[B");
    actions.dialog.handleInput("\u001B[A");
    actions.dialog.handleInput("\u001B[A");
    expect(actions.dialog.render(90).join("\n")).toContain("▸");
    actions.dialog.handleInput("\r");
    actions.dialog.handleInput("\r");
    expect(actions.submitted).toEqual([{ gitContext: "full" }]);
  });

  test("supports reverse focus navigation and requests redraws after state changes", () => {
    const { dialog, renders } = makeDialog();

    dialog.handleInput("\t");
    dialog.handleInput("\u001B[Z");
    expect(renders()).toBeGreaterThan(0);

    const before = dialog.render(80).join("\n");
    dialog.handleInput("x");
    const after = dialog.render(80).join("\n");
    expect(after).not.toBe(before);
  });

  test("keeps the dialog retryable when submit fails", () => {
    const { tui } = makeTui();
    let attempts = 0;
    const dialog = new ManualAdvisorDialog({
      gitContext: "summary",
      keybindings: getKeybindings(),
      onCancel: () => {},
      onSubmit: () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("submit failed");
        }
      },
      theme,
      tui,
    });
    dialog.focused = true;

    expect(() => dialog.handleInput("\r")).toThrow("submit failed");
    dialog.handleInput("\r");
    expect(attempts).toBe(2);
  });

  test("ignores reentrant submit events while submitting", () => {
    const { tui } = makeTui();
    let attempts = 0;
    const dialog = new ManualAdvisorDialog({
      gitContext: "summary",
      keybindings: getKeybindings(),
      onCancel: () => {},
      onSubmit: () => {
        attempts += 1;
        dialog.handleInput("\r");
      },
      theme,
      tui,
    });
    dialog.focused = true;

    dialog.handleInput("\r");
    expect(attempts).toBe(1);
  });

  test("cancels exactly once and suppresses input after completion", () => {
    const { dialog, submitted, cancelled } = makeDialog();

    dialog.handleInput("\u001B");
    dialog.handleInput("\r");
    dialog.handleInput("a");
    dialog.handleInput("\t");

    expect(cancelled()).toBe(1);
    expect(submitted).toHaveLength(0);
  });

  test("keeps every rendered line within narrow widths", () => {
    const { dialog } = makeDialog({
      gitContext: "full",
      initialMessage: "A very long message that needs to stay within the modal",
    });

    for (const width of [1, 2, 3, 4, 12, 24]) {
      for (const line of dialog.render(width)) {
        const lineWidth = visibleWidth(line);
        expect(lineWidth).toBeLessThanOrEqual(width);
        if (width >= 2) {
          expect(lineWidth).toBe(width);
        }
      }
    }
  });

  test("centers the action buttons between the borders", () => {
    const { dialog } = makeDialog();
    const buttons = "[Submit]  [Cancel]".length;
    // Row structure: border(1) + pad(1) + content + pad(1) + border(1), so the
    // centered start is 1 + (width - 2 - buttons) / 2 regardless of focus.
    const centeredStart = 1 + Math.floor((90 - 2 - buttons) / 2);

    const unfocused = actionsRow(dialog.render(90));
    expect(unfocused?.indexOf("[Submit]")).toBe(centeredStart);

    dialog.handleInput("\t");
    dialog.handleInput("\t");
    const focused = actionsRow(dialog.render(90));
    expect(focused?.indexOf("[Submit]")).toBe(centeredStart);
  });
});

describe("SearchableModelSelector", () => {
  test("keeps every rendered line within the terminal width", () => {
    const { selector } = makeModelSelector(
      [
        "some-very-long-provider/with-an-extremely-long-model-identifier-name",
        "provider/short",
      ],
      "provider/short"
    );

    for (const width of [20, 40, 79]) {
      for (const line of selector.render(width)) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });

  test("frames the list with single border rules and a dim hint row", () => {
    // The mock must emit real ANSI escapes: the component's final
    // truncateToWidth treats them as zero-width, unlike literal text.
    const codes: AnsiCodeTable = {
      accent: 36,
      border: 90,
      dim: 2,
      muted: 37,
      text: 39,
    };
    // SAFETY: recording theme emits real ANSI escapes so width math sees them as zero-width.
    const recordingTheme = {
      bold: (value: string) => `\u001B[1m${value}\u001B[22m`,
      fg: (color: string, value: string) =>
        `\u001B[${codes[color] ?? 39}m${value}\u001B[39m`,
    } as any;
    const { selector } = makeModelSelector(
      ["provider/one"],
      undefined,
      recordingTheme
    );

    const lines = selector.render(60);
    expect(stripTerminalSequences(lines[0])).toBe("─".repeat(60));
    expect(stripTerminalSequences(lines.at(-1) ?? "")).toBe("─".repeat(60));
    expect(lines.join("\n")).toContain("\u001B[2mType to search");
    expect(lines.join("\n")).not.toContain("═");
  });

  test("still selects the highlighted model after truncation", () => {
    const { selected, selector } = makeModelSelector([
      "a-very-long-provider-name/and-a-very-long-model-name",
    ]);
    selector.render(30);
    selector.handleInput("\r");
    expect(selected()).toBe(
      "a-very-long-provider-name/and-a-very-long-model-name"
    );
  });
});

describe("TextSettingSubmenu", () => {
  test("shows a validation error and clears it on the next input change", () => {
    const submitted: string[] = [];
    const submenu = new TextSettingSubmenu({
      description: "Enter a value.",
      initial: "",
      onCancel: () => {},
      onSubmit: (value) => {
        if (value.includes("@")) {
          submitted.push(value);
          return { value };
        }
        return { error: "Needs an @." };
      },
      theme,
      title: "Target",
      tui: { requestRender: () => {} },
    });

    submenu.handleInput("x");
    submenu.handleInput("\r");
    expect(submenu.render(60).join("\n")).toContain("Needs an @.");

    submenu.handleInput("@");
    expect(submenu.render(60).join("\n")).not.toContain("Needs an @.");

    submenu.handleInput("\r");
    expect(submitted).toEqual(["x@"]);
  });
});

describe("AdvisorSettingsSelector simple mode label", () => {
  const presets = [
    {
      description: "Everything",
      label: "Full",
      value: Number.MAX_SAFE_INTEGER,
    },
    { description: "20k chars", label: "20k", value: 20_000 },
  ];
  const makeSelector = (simpleMode: boolean) => {
    let renders = 0;
    const selector = new AdvisorSettingsSelector({
      effortLevels: ["Default (Model Default)"],
      initial: {
        collapseResponses: false,
        completionGate: true,
        contextMaxChars: 20_000,
        failureGate: true,
        planGate: true,
        simpleMode,
      },
      onCancel: () => {},
      onChange: () => {},
      presets,
      // SAFETY: formatting theme pairs every fg color name with the text for render assertions.
      theme: {
        bold: (value: string) => value,
        fg: (color: string, value: string) => `[${color}]${value}`,
      } as any,
      tui: {
        requestRender: () => {
          renders += 1;
        },
      },
    });
    selector.focused = true;
    return { renders: () => renders, selector };
  };

  test("shimmers the Simple mode label while simple mode is on", () => {
    const { selector } = makeSelector(true);
    try {
      // Per-character gradient escapes fragment the label text.
      const screen = selector.render(80).join("\n");
      expect(screen).not.toContain("Simple mode");
      expect(screen).toContain("38;2;");
    } finally {
      selector.dispose();
    }
  });

  test("leaves the label plain when simple mode is off", () => {
    const { selector } = makeSelector(false);
    try {
      expect(selector.render(80).join("\n")).toContain("Simple mode");
    } finally {
      selector.dispose();
    }
  });
});

describe("MaskedInput and OMP host TUI boundaries (Phase 02 / T1-T5)", () => {
  test("masks secret input, tracks cursor moves and paste, and bounds width in Pi 1.x (T5)", () => {
    const submitted: string[] = [];
    let escaped = 0;
    const masked = new MaskedInput({
      onEscape: () => {
        escaped += 1;
      },
      onSubmit: (value) => {
        submitted.push(value);
      },
      placeholder: "Paste API key",
    });

    expect(masked.render(30)[0]).toContain("Paste API key");

    for (const ch of "sk-live") {
      masked.handleInput(ch);
    }
    masked.handleInput("\u001B[D");
    masked.handleInput("\u001B[D");
    const midCaret = stripTerminalSequences(masked.render(30)[0] ?? "");
    expect(midCaret).toBe("•••••█••");
    expect(midCaret).not.toContain("sk");

    masked.setValue("sk-live-secret-token");
    for (const width of [1, 2, 4, 8, 16, 40]) {
      const [line = ""] = masked.render(width);
      expect(visibleWidth(line)).toBeLessThanOrEqual(Math.max(1, width));
      expect(stripTerminalSequences(line)).not.toContain("sk");
      expect(stripTerminalSequences(line)).not.toContain("secret");
    }

    const nonAscii = new MaskedInput();
    for (const ch of "ключ-秘密") {
      nonAscii.handleInput(ch);
    }
    nonAscii.handleInput("\u001B[D");
    const nonAsciiLine = stripTerminalSequences(nonAscii.render(30)[0] ?? "");
    expect(nonAsciiLine).toBe("••••••█•");
    expect(nonAsciiLine).not.toContain("ключ");
    expect(nonAsciiLine).not.toContain("秘密");

    let forcedCursor = Number.NaN;
    Object.defineProperty(Input.prototype, "getCursor", {
      configurable: true,
      value: () => forcedCursor,
    });
    try {
      expect(stripTerminalSequences(nonAscii.render(30)[0] ?? "")).toBe(
        "•••••••█"
      );
      forcedCursor = -5;
      expect(stripTerminalSequences(nonAscii.render(30)[0] ?? "")).toBe(
        "█•••••••"
      );
      forcedCursor = 999;
      expect(stripTerminalSequences(nonAscii.render(30)[0] ?? "")).toBe(
        "•••••••█"
      );
      forcedCursor = 2.9;
      expect(stripTerminalSequences(nonAscii.render(30)[0] ?? "")).toBe(
        "••█•••••"
      );
    } finally {
      Reflect.deleteProperty(Input.prototype, "getCursor");
    }
    masked.handleInput("\r");
    masked.handleInput("\u001B");
    expect(submitted).toEqual(["sk-live-secret-token"]);
    expect(escaped).toBe(1);
  });

  test("throws diagnostic error before constructing overlay when Editor has setTheme without complete HostSymbolTheme (T1 diagnostic)", () => {
    Object.defineProperty(Editor.prototype, "setTheme", {
      configurable: true,
      value: () => {},
    });
    try {
      expect(() => makeDialog({ initialMessage: "Check" })).toThrow(
        "Incompatible host Editor capability: OMP Editor requires a complete SymbolTheme from getSelectListTheme()."
      );
    } finally {
      Reflect.deleteProperty(Editor.prototype, "setTheme");
    }
  });

  test("exercises real OMP Editor, SettingsListAdapter, and MaskedInput in an isolated OMP subprocess (T1-T5)", async () => {
    const probe = await runOmpHostProbe();
    expect(probe.editorHasSetTheme).toBe(true);
    expect(isHostSymbolTheme(probe.selectListSymbols)).toBe(true);
    expect(hasSettingsListPublicContract(probe.settingsListContract)).toBe(
      false
    );
    expect(probe.settingsListContract.hasContract).toBe(true);

    const packageRoot = resolvePath(import.meta.dirname, "..");
    const script = `
      import { installLegacyPiSpecifierShim, loadLegacyPiModule } from "./packages/coding-agent/src/extensibility/plugins/legacy-pi-compat.ts";
      import { getSelectListTheme, getSettingsListTheme, initTheme } from "./packages/coding-agent/src/extensibility/legacy-pi-coding-agent-shim.ts";
      import { theme } from "./packages/tui/src/theme/theme.ts";
      import { Editor, Input, SettingsList, getKeybindings, stripTerminalSequences, visibleWidth } from "./packages/coding-agent/src/extensibility/legacy-pi-tui-shim.ts";

      installLegacyPiSpecifierShim();
      await initTheme("dark");

      const { ManualAdvisorDialog } = await loadLegacyPiModule(${JSON.stringify(join(packageRoot, "src/ui/manual-dialog.ts"))});
      const { SettingsListAdapter } = await loadLegacyPiModule(${JSON.stringify(join(packageRoot, "src/ui/settings-list-adapter.ts"))});
      const { MaskedInput } = await loadLegacyPiModule(${JSON.stringify(join(packageRoot, "src/ui/masked-input.ts"))});

      const plainTheme = {
        bg: (_c, text) => text,
        bold: (text) => text,
        fg: (_c, text) => text,
      };
      const submitted = [];
      let cancelled = 0;
      const dialog = new ManualAdvisorDialog({
        gitContext: "full",
        initialMessage: "Check",
        keybindings: getKeybindings(),
        onCancel: () => { cancelled += 1; },
        onSubmit: (req) => { submitted.push(req); },
        theme: plainTheme,
        tui: { requestRender: () => {}, terminal: { rows: 24 } },
      });
      dialog.focused = true;

      const widths = [1, 2, 4, 12, 24, 76, 90];
      const widthBoundsOk = widths.every((w) =>
        dialog.render(w).every((line) => visibleWidth(line) <= w)
      );

      for (const ch of " migration") {
        dialog.handleInput(ch);
      }
      dialog.handleInput("\\n");
      for (const ch of "Second") {
        dialog.handleInput(ch);
      }
      dialog.handleInput("\\t");
      dialog.handleInput("\\u001b[B");
      dialog.handleInput("\\t");
      dialog.handleInput("\\r");

      const cancelDialog = new ManualAdvisorDialog({
        gitContext: "summary",
        initialMessage: "Abort me",
        keybindings: getKeybindings(),
        onCancel: () => { cancelled += 1; },
        onSubmit: (req) => { submitted.push(req); },
        theme: plainTheme,
        tui: { requestRender: () => {}, terminal: { rows: 24 } },
      });
      cancelDialog.focused = true;
      cancelDialog.handleInput("\\u001b");

      let diagnosticError = "";
      Object.defineProperty(theme, "boxSharp", {
        configurable: true,
        value: { topLeft: "" },
      });
      try {
        new ManualAdvisorDialog({
          gitContext: "summary",
          keybindings: getKeybindings(),
          onCancel: () => {},
          onSubmit: () => {},
          theme: plainTheme,
          tui: { requestRender: () => {}, terminal: { rows: 24 } },
        });
      } catch (err) {
        diagnosticError = err instanceof Error ? err.message : String(err);
      } finally {
        Reflect.deleteProperty(theme, "boxSharp");
      }

      const items = [
        { id: "mode", label: "Simple mode", currentValue: "Off", values: ["On", "Off"] },
        { id: "gate", label: "Plan gate", currentValue: "On", values: ["On", "Off"] },
        {
          id: "sub",
          label: "Submenu row",
          currentValue: "auto",
          submenu: (_val, done) => ({
            focused: false,
            handleInput: (key) => { if (key === "\\u001b") done(undefined); },
            invalidate: () => {},
            render: () => ["submenu"],
          }),
        },
      ];
      const list = new SettingsList(
        items,
        10,
        getSettingsListTheme(),
        () => {},
        () => {}
      );
      const adapter = new SettingsListAdapter(list);
      adapter.privateFields = () => {
        throw new Error("privateFields fallback must not run on OMP SettingsList");
      };
      const changes = [];
      const cycledRight = adapter.changeWithArrow("\\u001b[C", (id, val) => changes.push([id, val]));
      const afterCycleValue = list.getSelectedItem()?.currentValue ?? null;
      adapter.setSelectedId(items, "gate");
      const afterSelectId = list.getSelectedItem()?.id ?? null;

      list.handleInput("gate");
      const searchActive = list.hasSearchQuery();
      const blockedDuringSearch = adapter.changeWithArrow("\\u001b[C", (id, val) => changes.push([id, val]));
      list.clearSearch();

      adapter.setSelectedId(items, "sub");
      list.handleInput("\\r");
      const submenuOpen = list.hasOpenSubmenu();
      adapter.setFocused(true);
      const submenuFocused = Boolean(adapter.submenuComponent && adapter.submenuComponent.focused);
      const blockedDuringSubmenu = adapter.changeWithArrow("\\u001b[C", (id, val) => changes.push([id, val]));

      const masked = new MaskedInput({ placeholder: "Key" });
      for (const ch of "secret-token") {
        masked.handleInput(ch);
      }
      for (let i = 0; i < 5; i += 1) {
        masked.handleInput("\\u001b[D");
      }
      const maskedLine = stripTerminalSequences(masked.render(40)[0] ?? "");
      masked.setValue("ключ-秘密");
      masked.handleInput("\\u001b[D");
      const nonAsciiMaskedLine = stripTerminalSequences(masked.render(40)[0] ?? "");
      const maskedWidthsOk = [1, 4, 10, 40].every((w) =>
        masked.render(w).every((line) => visibleWidth(line) <= Math.max(1, w))
      );

      console.log(JSON.stringify({
        afterCycleValue,
        afterSelectId,
        blockedDuringSearch,
        blockedDuringSubmenu,
        cancelled,
        changes,
        cycledRight,
        diagnosticError,
        maskedLine,
        maskedValue: masked.getValue(),
        maskedWidthsOk,
        nonAsciiMaskedLine,
        searchActive,
        submenuFocused,
        submenuOpen,
        submitted,
        widthBoundsOk,
      }));
    `;

    const result = await runOmpScript("omp-tui-boundary-", script, (line) =>
      JSON.parse(line)
    );
    expect(result.widthBoundsOk).toBe(true);
    expect(result.submitted).toEqual([
      { gitContext: "summary", message: "Check migration\nSecond" },
    ]);
    expect(result.cancelled).toBe(1);
    expect(result.diagnosticError).toBe(
      "Incompatible host Editor capability: OMP Editor requires a complete SymbolTheme from getSelectListTheme()."
    );
    expect(result.cycledRight).toBe(true);
    expect(result.afterCycleValue).toBe("On");
    expect(result.changes).toEqual([["mode", "On"]]);
    expect(result.afterSelectId).toBe("gate");
    expect(result.searchActive).toBe(true);
    expect(result.blockedDuringSearch).toBe(false);
    expect(result.submenuOpen).toBe(true);
    expect(result.submenuFocused).toBe(true);
    expect(result.blockedDuringSubmenu).toBe(false);
    expect(result.maskedValue).toBe("ключ-秘密");
    expect(result.maskedLine).toBe("•••••••█•••••");
    expect(result.maskedLine).not.toContain("secret");
    expect(result.nonAsciiMaskedLine).toBe("••••••█•");
    expect(result.nonAsciiMaskedLine).not.toContain("ключ");
    expect(result.nonAsciiMaskedLine).not.toContain("秘密");
    expect(result.maskedWidthsOk).toBe(true);
  });
});
