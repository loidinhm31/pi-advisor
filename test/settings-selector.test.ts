import { describe, expect, test } from "bun:test";
import { join, resolve as resolvePath } from "node:path";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";

import { registerCommands } from "../src/commands.ts";
import {
  advisorScoutEnabledRef,
  setAdvisorCollapseResponsesRef,
} from "../src/config.ts";
import { adviceForDisplay, registerAdvisorTool } from "../src/tools.ts";
import { AdvisorSettingsSelector } from "../src/ui.ts";
import type { AdvisorSettings } from "../src/ui/types.ts";
import { savedConfig, withAgentDir } from "./helpers/config-fixture.ts";
import { runOmpScript } from "./helpers/dual-host-harness.ts";
import { asExtensionContext } from "./helpers/extension-context.ts";
import { dispatchBeforeAgentStart } from "./helpers/harness.ts";
import type { DualHostEventHandler } from "./helpers/harness.ts";
import { mockPi } from "./helpers/mock-pi.ts";
import {
  changeSetting,
  focusSettingsRow,
} from "./helpers/settings-navigation.ts";

initTheme();

const SCOUT_ON_PATTERN = /Experimental Advisor Scout\s+On/u;
const MAX_CALLS_ROW_PATTERN = /Max Advisor calls\/session\s+10/u;

const reachRowLine = (
  selector: AdvisorSettingsSelector,
  label: string
): string | undefined => {
  for (let step = 0; step < 60; step += 1) {
    const lines = stripTerminalSequences(selector.render(120).join("\n")).split(
      "\n"
    );
    const focused = lines.find((line) => line.includes(`→ ${label}`));
    if (focused) {
      return focused;
    }
    selector.handleInput("\u001B[B");
  }
  return undefined;
};

// SAFETY: theme stub implements only the bold/fg members the settings selector renders with.
const selectorTheme = {
  bold: (text: string) => text,
  fg: (_color: string, text: string) => text,
} as any;

const custom = async (factory: any) =>
  new Promise<any>((resolve) => {
    const selector = factory(
      { requestRender: () => {} },
      selectorTheme,
      {},
      resolve
    );

    focusSettingsRow(selector, "Experimental Advisor Scout");
    changeSetting(selector, "Experimental Advisor Scout");
    changeSetting(selector, "Max Advisor calls/session");
    selector.handleInput("\u001B");
  });

const reopened = async (factory: any) =>
  new Promise<any>((resolve) => {
    const selector = factory(
      { requestRender: () => {} },
      selectorTheme,
      {},
      resolve
    );

    const initialScreen = stripTerminalSequences(
      selector.render(100).join("\n")
    );

    expect(initialScreen).toMatch(SCOUT_ON_PATTERN);

    for (const key of ["m", "a", "x"]) {
      selector.handleInput(key);
    }

    const screen = stripTerminalSequences(selector.render(100).join("\n"));
    expect(screen).toMatch(MAX_CALLS_ROW_PATTERN);
    selector.handleInput("\u001B");
  });

const openSelector = (overrides: {
  onChange?: (settings: any) => void;
  onSave?: (settings: any) => void;
  initial?: Partial<AdvisorSettings>;
  modelRefs?: string[];
  presets?: { description: string; label: string; value: number }[];
}) => {
  const saved: any[] = [];

  const selector = new AdvisorSettingsSelector({
    effortLevels: ["Default (Model Default)", "high"],
    initial: {
      collapseResponses: false,
      completionGate: true,
      contextMaxChars: 0,
      failureGate: true,
      planGate: true,
      ...overrides.initial,
    },
    // SAFETY: keybindings stub only needs matches() to deny every key sequence.
    keybindings: { matches: () => false } as any,
    modelRefs: overrides.modelRefs ?? ["provider/one", "provider/two"],
    onCancel: () => {},
    onChange:
      overrides.onChange ??
      (overrides.onSave ? undefined : (settings) => saved.push(settings)),
    onSave: overrides.onSave,
    presets: overrides.presets ?? [
      { description: "No history", label: "0", value: 0 },
      { description: "Recent history", label: "10k", value: 10_000 },
    ],
    theme: selectorTheme,
    tui: { requestRender: () => {} },
  });

  return { saved, selector };
};

describe("Advisor settings selector", () => {
  test("uses a compact searchable settings list and saves each change", () => {
    const { saved, selector } = openSelector({});
    const screen = selector.render(80).join("\n");
    expect(screen).toContain("Advisor tools");
    expect(screen).toContain("Advisor reasoning");
    expect(screen).toContain("Experimental Advisor Scout");
    expect(screen).not.toContain("Save changes");
    expect(screen).toContain("Type to search");

    changeSetting(selector, "Context window");
    changeSetting(selector, "Show usage and cost details");
    expect(saved.at(-1)).toMatchObject({
      contextMaxChars: 10_000,
      showUsageDetails: false,
    });

    for (const key of ["s", "e", "c", "r", "e", "t"]) {
      selector.handleInput(key);
    }

    expect(selector.render(100).join("\n")).toContain("Redact common secrets");
  });

  test("uses arrow keys to change the selected setting", () => {
    let saved: any;

    const { selector } = openSelector({
      onChange: (settings) => {
        saved = settings;
      },
    });

    selector.handleInput("\u001B[C");
    expect(saved.contextMaxChars).toBe(10_000);
    selector.handleInput("\u001B[D");
    expect(saved.contextMaxChars).toBe(0);
  });

  test("uses Space to toggle and auto-save a setting", () => {
    let saved: any;

    const { selector } = openSelector({
      onChange: (settings) => {
        saved = settings;
      },
      presets: [{ description: "No history", label: "0", value: 0 }],
    });

    focusSettingsRow(selector, "Always on");
    selector.handleInput(" ");
    expect(saved.alwaysOn).toBe(true);
  });

  test("shows AGENTS.md context on by default and persists the toggle", () => {
    let saved: any;

    const { selector } = openSelector({
      onChange: (settings) => {
        saved = settings;
      },
    });

    focusSettingsRow(selector, "AGENTS.md context");
    expect(stripTerminalSequences(selector.render(120).join("\n"))).toContain(
      "AGENTS.md context"
    );
    selector.handleInput(" ");
    expect(saved.agentsMdContext).toBe(false);
  });

  test("renders a context depth meter", () => {
    const { selector } = openSelector({
      initial: { contextMaxChars: Number.MAX_SAFE_INTEGER },
      presets: [
        { description: "No history", label: "0", value: 0 },
        {
          description: "Full branch",
          label: "ALL",
          value: Number.MAX_SAFE_INTEGER,
        },
      ],
    });

    const screen = selector.render(100).join("\n");
    const stripped = stripTerminalSequences(screen);
    const lines = stripped.split("\n");
    const meterLine = lines.find((line) => line.includes("none"));
    const labelLine = lines.find((line) => line.trim() === "ALL");

    if (!(meterLine && labelLine)) {
      throw new Error("Context meter did not render its marker and label");
    }

    expect(meterLine).toContain("full");
    expect(meterLine).toContain("●");
    expect(labelLine.indexOf("ALL")).toBe(meterLine.indexOf("●") - 1);
    expect(stripped).not.toContain("████");
  });

  test("restores Simple mode animation", () => {
    const { selector } = openSelector({
      initial: { simpleMode: true },
      presets: [{ description: "No history", label: "0", value: 0 }],
    });

    expect(selector.render(100).join("\n")).toContain("\u001B[38;2;");
    selector.dispose();
  });

  test("hides Scout in Simple mode without losing its saved value", () => {
    let saved: any;

    const { selector } = openSelector({
      initial: { scoutEnabled: true, simpleMode: true },
      onSave: (settings) => {
        saved = settings;
      },
      presets: [{ description: "No history", label: "0", value: 0 }],
    });

    expect(selector.render(100).join("\n")).not.toContain(
      "Experimental Advisor Scout"
    );
    changeSetting(selector, "Simple mode");
    expect(stripTerminalSequences(selector.render(100).join("\n"))).toMatch(
      SCOUT_ON_PATTERN
    );
    expect(saved.scoutEnabled).toBe(true);
    selector.dispose();
  });

  test("toggles same-model suppression in Simple mode", () => {
    const { saved, selector } = openSelector({ initial: { simpleMode: true } });
    focusSettingsRow(selector, "Disable same-model Advisor");
    expect(stripTerminalSequences(selector.render(100).join("\n"))).toContain(
      "Disable same-model Advisor"
    );
    changeSetting(selector, "Disable same-model Advisor");
    expect(saved.at(-1).disableSameModel).toBe(false);
    changeSetting(selector, "Disable same-model Advisor");
    expect(saved.at(-1).disableSameModel).toBe(true);
    selector.dispose();
  });

  test("preserves explicit privacy settings through the selector", () => {
    let saved: any;

    const { selector } = openSelector({
      initial: {
        redactSecrets: true,
        toolPolicies: { bash: "summary", deploy: "exclude" },
      },
      onSave: (settings) => {
        saved = settings;
      },
      presets: [{ description: "No history", label: "0", value: 0 }],
    });

    changeSetting(selector, "Simple mode");
    expect(saved).toMatchObject({
      redactSecrets: true,
      toolPolicies: { bash: "summary", deploy: "exclude" },
    });
  });

  test("keeps invalid tool disclosure policies open with an actionable error", () => {
    const { selector } = openSelector({
      onSave: () => {},
      presets: [{ description: "No history", label: "0", value: 0 }],
    });

    focusSettingsRow(selector, "Tool disclosure policies");
    selector.handleInput("\r");
    // SAFETY: settingsList.submenuComponent is the editor the selector renders for this row.
    const editor = (selector as any).settingsList.submenuComponent;
    editor.input.onSubmit('{"bash":"invalid"}');
    expect(selector.render(120).join("\n")).toContain(
      "Use non-empty tool names with full, summary, or exclude values."
    );
    editor.input.onSubmit("{");
    expect(selector.render(120).join("\n")).toContain(
      "Enter a valid JSON object."
    );
  });

  test("selects multiple models from the Advisor model whitelist menu", () => {
    let saved: any;

    const { selector } = openSelector({
      onSave: (settings) => {
        saved = settings;
      },
      presets: [{ description: "No history", label: "0", value: 0 }],
    });

    focusSettingsRow(selector, "Advisor model whitelist");
    selector.handleInput("\r");
    selector.handleInput(" ");
    selector.handleInput("\u001B[B");
    selector.handleInput(" ");
    selector.handleInput("\r");
    expect(saved.modelWhitelist).toEqual(["provider/one", "provider/two"]);
  });

  test("edits the custom invocation rule inline", () => {
    let saved: any;

    const { selector } = openSelector({
      onSave: (settings) => {
        saved = settings;
      },
      presets: [{ description: "No history", label: "0", value: 0 }],
    });

    focusSettingsRow(selector, "Custom invocation");
    selector.handleInput("\r");

    for (const character of "deploy") {
      selector.handleInput(character);
    }

    selector.handleInput("\r");
    expect(saved.customRule).toBe("deploy");
  });

  test("reopens Advisor settings with the value saved in the same session", async () => {
    await withAgentDir({ advisorMaxCallsPerSession: 5 }, async (agentDir) => {
      const commands = new Map<string, any>();
      registerCommands(mockPi({ commands }));

      const context = asExtensionContext({
        cwd: "/",
        hasUI: true,
        isProjectTrusted: () => false,
        ui: { custom, notify: () => {}, setStatus: () => {} },
      });

      await commands.get("advisor-settings").handler("", context);
      expect(savedConfig(agentDir)).toMatchObject({
        advisorMaxCallsPerSession: 10,
        advisorScoutEnabled: true,
      });
      expect(advisorScoutEnabledRef).toBe(true);
      context.ui.custom = reopened;
      await commands.get("advisor-settings").handler("", context);
    });
  });

  test("keeps Advisor answers expanded unless collapse is enabled", () => {
    const longAnswer = Array.from(
      { length: 14 },
      (_, index) => `line ${index + 1}`
    ).join("\n");

    setAdvisorCollapseResponsesRef(false);
    expect(adviceForDisplay(longAnswer, false)).toBe(longAnswer);
    setAdvisorCollapseResponsesRef(true);
    expect(adviceForDisplay(longAnswer, false)).toContain("Ctrl+O to expand");
    expect(adviceForDisplay(longAnswer, true)).toBe(longAnswer);
    setAdvisorCollapseResponsesRef(false);
  });

  test("roundtrips Simple mode and individual gate toggles through saveAdvisorSettings and before_agent_start across Pi and OMP SettingsList shapes (T4, S1-S4)", async () => {
    const seededConfig = {
      advisor: "openai-codex/gpt-6.1-sol",
      advisorFallbackModel: "anthropic/claude-opus-5-5",
      advisorGitContext: "summary" as const,
      advisorMaxCallsPerSession: 5,
      advisorModelWhitelist: ["google-antigravity/gemini-3.8-flash"],
      advisorRedactSecrets: true,
      advisorToolPolicies: { bash: "summary" as const },
      alwaysOn: true,
      customOperatorNote: "preserve-unrelated-field",
      executor: "google-antigravity/gemini-3.8-flash",
      simpleMode: true,
    };

    await withAgentDir(seededConfig, async (agentDir) => {
      const commands = new Map<
        string,
        {
          handler: (args: string, ctx: ExtensionContext) => Promise<void>;
        }
      >();
      const events = new Map<string, DualHostEventHandler>();
      const pi = mockPi({ activeTools: ["ask_advisor"], commands, events });
      registerCommands(pi);
      registerAdvisorTool(pi);

      let activeSelector: AdvisorSettingsSelector | undefined;
      let stepPhase = 1;
      const context = asExtensionContext({
        cwd: "/",
        hasUI: true,
        isProjectTrusted: () => false,
        model: { id: "gemini-3.8-flash", provider: "google-antigravity" },
        modelRegistry: {
          getAll: () => [
            { id: "gemini-3.8-flash", provider: "google-antigravity" },
            { id: "gpt-6.1-sol", provider: "openai-codex" },
            { id: "claude-opus-5-5", provider: "anthropic" },
          ],
          getAvailable: () => [
            { id: "gemini-3.8-flash", provider: "google-antigravity" },
            { id: "gpt-6.1-sol", provider: "openai-codex" },
            { id: "claude-opus-5-5", provider: "anthropic" },
          ],
        },
        ui: {
          custom: async (
            factory: (
              tui: { requestRender: () => void },
              theme: typeof selectorTheme,
              keybindings: { matches: () => boolean },
              done: (value: undefined) => void
            ) => AdvisorSettingsSelector
          ) => {
            const { promise, resolve } = Promise.withResolvers<undefined>();
            const created = factory(
              { requestRender: () => {} },
              selectorTheme,
              { matches: () => false },
              resolve
            );
            activeSelector = created;
            if (stepPhase === 1) {
              // 1. In Simple mode, advanced gate rows are absent while Simple mode & Always on remain accessible.
              expect(reachRowLine(created, "Simple mode")).toMatch(
                /Simple mode\s+On/u
              );
              expect(reachRowLine(created, "Always on")).toMatch(
                /Always on\s+On/u
              );
              for (const hiddenLabel of [
                "Plan gate",
                "Failure gate",
                "Completion gate",
                "Custom invocation",
                "Automatic loop gate",
                "Loop threshold",
                "Max Advisor calls/session",
              ]) {
                expect(reachRowLine(created, hiddenLabel)).toBeUndefined();
              }

              // 2. Toggle Simple mode Off via Right arrow; advanced rows appear with Plan/Failure/Completion On.
              expect(reachRowLine(created, "Simple mode")).toBeDefined();
              created.handleInput("\u001B[C");
              expect(reachRowLine(created, "Simple mode")).toMatch(
                /Simple mode\s+Off/u
              );
              expect(reachRowLine(created, "Plan gate")).toMatch(
                /Plan gate\s+On/u
              );
              expect(reachRowLine(created, "Failure gate")).toMatch(
                /Failure gate\s+On/u
              );
              expect(reachRowLine(created, "Completion gate")).toMatch(
                /Completion gate\s+On/u
              );
              expect(reachRowLine(created, "Custom invocation")).toBeDefined();
              expect(reachRowLine(created, "Automatic loop gate")).toMatch(
                /Automatic loop gate\s+On/u
              );
              expect(reachRowLine(created, "Loop threshold")).toBeDefined();
              expect(
                reachRowLine(created, "Max Advisor calls/session")
              ).toBeDefined();

              // 3. Toggle Failure gate Off, set Max calls to 10, and set Custom invocation via TextSettingSubmenu.
              expect(reachRowLine(created, "Failure gate")).toBeDefined();
              created.handleInput(" ");
              expect(reachRowLine(created, "Failure gate")).toMatch(
                /Failure gate\s+Off/u
              );

              expect(
                reachRowLine(created, "Max Advisor calls/session")
              ).toBeDefined();
              created.handleInput("\u001B[C");
              expect(
                reachRowLine(created, "Max Advisor calls/session")
              ).toMatch(/Max Advisor calls\/session\s+10/u);

              expect(reachRowLine(created, "Custom invocation")).toBeDefined();
              created.handleInput("\r");
              for (const ch of "before schema migrations") {
                created.handleInput(ch);
              }
              created.handleInput("\r");
            } else if (stepPhase === 2) {
              expect(reachRowLine(created, "Simple mode")).toMatch(
                /Simple mode\s+Off/u
              );
              created.handleInput("\u001B[D");
              expect(reachRowLine(created, "Simple mode")).toMatch(
                /Simple mode\s+On/u
              );
              expect(reachRowLine(created, "Failure gate")).toBeUndefined();
              created.dispose();
            } else {
              expect(reachRowLine(created, "Simple mode")).toMatch(
                /Simple mode\s+On/u
              );
              created.handleInput("\u001B[C");
              expect(reachRowLine(created, "Failure gate")).toMatch(
                /Failure gate\s+Off/u
              );
              created.dispose();
            }
            resolve(undefined);
            return promise;
          },
          notify: () => {},
          setStatus: () => {},
        },
      });

      await commands.get("advisor-settings")?.handler("", context);
      activeSelector?.dispose();

      const fullGateOutcome = await dispatchBeforeAgentStart(
        events,
        {
          systemPrompt: [
            "Base system prompt",
            "## Devices\n- xd://ask_advisor",
          ],
        },
        context
      );
      const fullGatePrompt = fullGateOutcome.result?.systemPrompt;
      expect(Array.isArray(fullGatePrompt)).toBe(true);
      const ownedBlock = Array.isArray(fullGatePrompt)
        ? (fullGatePrompt[2] ?? "")
        : "";
      expect(ownedBlock).toContain(
        "<!-- pi-advisor-flow:invocation-settings:start -->"
      );
      expect(ownedBlock).toContain("materially consequential plan");
      expect(ownedBlock).toContain("Before declaring success");
      expect(ownedBlock).toContain("before schema migrations");
      expect(ownedBlock).toContain("Advisor calls remaining this session: 10.");
      expect(ownedBlock).not.toContain(
        "two consecutive materially equivalent failed attempts"
      );

      // 4. Verify persisted advisor.json retains all model, privacy, and unknown keys without credentials.
      const persistedAfterOff = savedConfig(agentDir);
      expect(persistedAfterOff).toMatchObject({
        advisor: "openai-codex/gpt-6.1-sol",
        advisorCustomInvocation: "before schema migrations",
        advisorFailureGate: false,
        advisorFallbackModel: "anthropic/claude-opus-5-5",
        advisorGitContext: "summary",
        advisorMaxCallsPerSession: 10,
        advisorModelWhitelist: ["google-antigravity/gemini-3.8-flash"],
        advisorRedactSecrets: true,
        advisorToolPolicies: { bash: "summary" },
        alwaysOn: true,
        customOperatorNote: "preserve-unrelated-field",
        executor: "google-antigravity/gemini-3.8-flash",
        simpleMode: false,
      });
      expect(persistedAfterOff).not.toHaveProperty("apiKey");
      expect(persistedAfterOff).not.toHaveProperty("jevApiKey");
      expect(persistedAfterOff).not.toHaveProperty("openaiApiKey");

      // 5. Toggle Simple mode back On -> emits single voluntary rule; turning Off again restores Failure gate Off.
      stepPhase = 2;
      await commands.get("advisor-settings")?.handler("", context);

      const simpleOutcome = await dispatchBeforeAgentStart(
        events,
        {
          systemPrompt: [
            "Base system prompt",
            "## Devices\n- xd://ask_advisor",
          ],
        },
        context
      );
      const simplePrompt = simpleOutcome.result?.systemPrompt;
      const simpleBlock = Array.isArray(simplePrompt)
        ? (simplePrompt[2] ?? "")
        : "";
      expect(simpleBlock).toContain("consult the Advisor for a second opinion");
      expect(simpleBlock).not.toContain("materially consequential plan");
      expect(simpleBlock).not.toContain("Before declaring success");
      expect(simpleBlock).not.toContain("before schema migrations");
      expect(simpleBlock).not.toContain(
        "Advisor calls remaining this session:"
      );
      expect(savedConfig(agentDir)).toMatchObject({
        advisorFailureGate: false,
        simpleMode: true,
      });

      stepPhase = 3;
      await commands.get("advisor-settings")?.handler("", context);
    });

    // Also verify the same roundtrip against real OMP #private-field SettingsList via SettingsListAdapter.
    const packageRoot = resolvePath(import.meta.dirname, "..");
    const ompScript = `
      import { readFileSync, writeFileSync } from "node:fs";
      import { join } from "node:path";
      import { installLegacyPiSpecifierShim, loadLegacyPiModule } from "./packages/coding-agent/src/extensibility/plugins/legacy-pi-compat.ts";
      import { initTheme } from "./packages/coding-agent/src/extensibility/legacy-pi-coding-agent-shim.ts";
      import { getKeybindings } from "./packages/coding-agent/src/extensibility/legacy-pi-tui-shim.ts";

      installLegacyPiSpecifierShim();
      await initTheme("dark");

      const { default: registerExtension } = await loadLegacyPiModule(${JSON.stringify(join(packageRoot, "extensions/index.ts"))});

      const agentDir = process.env.PI_CODING_AGENT_DIR;
      const configFile = join(agentDir, "advisor.json");
      writeFileSync(configFile, JSON.stringify(${JSON.stringify(seededConfig)}));
      const commands = new Map();
      const events = new Map();
      registerExtension({
        appendEntry: () => {},
        getActiveTools: () => ["ask_advisor"],
        on: (event, handler) => events.set(event, handler),
        registerCommand: (name, def) => commands.set(name, def),
        registerEntryRenderer: () => {},
        registerMessageRenderer: () => {},
        registerTool: () => {},
        sendMessage: () => {},
        setActiveTools: async () => {},
        setModel: async () => true,
        setThinkingLevel: () => {},
      });

      let hiddenWhenSimple = false;
      let visibleAfterOff = false;
      let failureAfterToggle = null;
      let simpleRestored = null;
      let failureAfterReopen = null;
      let ompPhase = 1;
      const ctx = {
        cwd: process.cwd(),
        hasUI: true,
        isProjectTrusted: () => false,
        model: { id: "gemini-3.8-flash", provider: "google-antigravity" },
        modelRegistry: { getAll: () => [], getAvailable: () => [] },
        ui: {
          custom: async (factory) => {
            const { promise, resolve } = Promise.withResolvers();
            const selector = factory(
              { requestRender: () => {} },
              { bold: (t) => t, fg: (_c, t) => t },
              getKeybindings(),
              resolve
            );
            Object.getPrototypeOf(selector.settingsList).privateFields = () => {
              throw new Error("OMP SettingsList must use SettingsListAdapter public-method contract");
            };
            const list = () => selector.settingsList.list;
            const hasItem = (id) => {
              list().selectItem(id);
              return list().getSelectedItem()?.id === id;
            };
            if (ompPhase === 1) {
              hiddenWhenSimple = ["planGate", "failureGate", "completionGate", "customRule", "autoLoopGate", "loopThreshold", "maxCallsPerSession"]
                .every((id) => !hasItem(id));
              list().selectItem("simpleMode");
              selector.handleInput("\\u001b[C");
              visibleAfterOff = ["planGate", "failureGate", "completionGate", "customRule", "autoLoopGate", "loopThreshold", "maxCallsPerSession"]
                .every((id) => hasItem(id));
              list().selectItem("failureGate");
              selector.handleInput("\\u001b[C");
              failureAfterToggle = list().getSelectedItem()?.currentValue ?? null;
              list().selectItem("customRule");
              selector.handleInput("\\r");
              for (const ch of "before schema migrations") {
                selector.handleInput(ch);
              }
              selector.handleInput("\\r");
            } else if (ompPhase === 2) {
              list().selectItem("simpleMode");
              selector.handleInput("\\u001b[D");
              simpleRestored = list().getSelectedItem()?.currentValue ?? null;
            } else {
              list().selectItem("simpleMode");
              selector.handleInput("\\u001b[C");
              list().selectItem("failureGate");
              failureAfterReopen = list().getSelectedItem()?.currentValue ?? null;
            }
            selector.dispose();
            resolve(undefined);
            return promise;
          },
          notify: () => {},
          setStatus: () => {},
        },
      };
      await commands.get("advisor-settings").handler("", ctx);
      const ompFullOut = await events.get("before_agent_start")({
        systemPrompt: ["Base system prompt", "## Devices\\n- xd://ask_advisor"],
      }, ctx);
      const ompFullBlock = Array.isArray(ompFullOut?.systemPrompt) ? (ompFullOut.systemPrompt[2] ?? "") : "";

      ompPhase = 2;
      await commands.get("advisor-settings").handler("", ctx);
      const ompSimpleOut = await events.get("before_agent_start")({
        systemPrompt: ["Base system prompt", "## Devices\\n- xd://ask_advisor"],
      }, ctx);
      const ompSimpleBlock = Array.isArray(ompSimpleOut?.systemPrompt) ? (ompSimpleOut.systemPrompt[2] ?? "") : "";

      ompPhase = 3;
      await commands.get("advisor-settings").handler("", ctx);
      const saved = JSON.parse(readFileSync(configFile, "utf-8"));
      console.log(JSON.stringify({
        failureAfterReopen,
        failureAfterToggle,
        hiddenWhenSimple,
        ompFullBlock,
        ompSimpleBlock,
        saved,
        simpleRestored,
        visibleAfterOff,
      }));
    `;
    const ompRoundtrip = await runOmpScript(
      "omp-settings-roundtrip-",
      ompScript,
      (line) => JSON.parse(line)
    );
    expect(ompRoundtrip.hiddenWhenSimple).toBe(true);
    expect(ompRoundtrip.visibleAfterOff).toBe(true);
    expect(ompRoundtrip.failureAfterToggle).toBe("Off");
    expect(ompRoundtrip.simpleRestored).toBe("On");
    expect(ompRoundtrip.failureAfterReopen).toBe("Off");
    expect(ompRoundtrip.ompFullBlock).toContain(
      "materially consequential plan"
    );
    expect(ompRoundtrip.ompFullBlock).toContain("Before declaring success");
    expect(ompRoundtrip.ompFullBlock).toContain("before schema migrations");
    expect(ompRoundtrip.ompFullBlock).toContain(
      "Advisor calls remaining this session: 5."
    );
    expect(ompRoundtrip.ompFullBlock).not.toContain(
      "two consecutive materially equivalent failed attempts"
    );
    expect(ompRoundtrip.ompSimpleBlock).toContain(
      "consult the Advisor for a second opinion"
    );
    expect(ompRoundtrip.ompSimpleBlock).not.toContain(
      "materially consequential plan"
    );
    expect(ompRoundtrip.saved).toMatchObject({
      advisorCustomInvocation: "before schema migrations",
      advisorFailureGate: false,
      customOperatorNote: "preserve-unrelated-field",
      simpleMode: false,
    });
  });
});
