import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";

import { initTheme } from "@earendil-works/pi-coding-agent";

import { registerCommands } from "../src/commands.ts";
import {
  contextMaxCharsRef,
  loadConfig,
  resetConfigCache,
  setShowUsageDetailsRef,
} from "../src/config.ts";
import { registerAdvisorTool } from "../src/tools.ts";
import { savedConfig, withAgentDir } from "./helpers/config-fixture.ts";
import { runOmpScript } from "./helpers/dual-host-harness.ts";
import { asExtensionContext } from "./helpers/extension-context.ts";
import {
  activationContext,
  activationHarness,
  dispatchBeforeAgentStart,
  plainTheme,
} from "./helpers/harness.ts";
import { mockPi } from "./helpers/mock-pi.ts";
import {
  changeSetting,
  focusSettingsRow,
} from "./helpers/settings-navigation.ts";

initTheme();

interface RegistryModel {
  id: string;
  provider: string;
}

interface OmpPromptProbeOutput {
  afterCleanSystemPrompt: string[] | null;
  afterOffSystemPrompt: string[] | null;
  retryLength: number;
  retryOwnedBlock: string;
  retryPrefix: string[];
}

interface SelectorTheme {
  bold: (value: string) => string;
  fg: (color: string, value: string) => string;
}

const modelsRegistry = (models: RegistryModel[]) => ({
  find: (provider: string, id: string) =>
    models.find((model) => model.provider === provider && model.id === id),
  getApiKeyAndHeaders: () => Promise.resolve({ apiKey: "key", ok: true }),
  getAvailable: () => models,
});

/** ui.custom that renders the selector, optionally types `search` on the
 * second opening, and submits with Enter. */
const typingSelectorUi = (
  theme: SelectorTheme,
  options: {
    onOpen?: () => void;
    onValue?: (value: string | undefined) => void;
    search?: string;
    searchAt?: number;
  } = {}
) => {
  let customCall = 0;

  return {
    custom: (factory: any) =>
      new Promise((resolve) => {
        const selector = factory(
          { requestRender: () => {} },
          theme,
          { matches: () => false },
          (value: string | undefined) => {
            options.onValue?.(value);
            resolve(value);
          }
        );

        options.onOpen?.();
        selector.render(100);

        if (customCall === (options.searchAt ?? 1) && options.search) {
          for (const character of options.search) {
            selector.handleInput(character);
          }

          selector.render(100);
        }

        customCall += 1;
        selector.handleInput("\r");
      }),
    notify: () => {},
    select: () => Promise.resolve("✓ Default (Model Default)"),
  };
};

describe("Advisor activation flow", () => {
  test("uses models selected in advisor-models when activating in the same session", async () => {
    await withAgentDir({}, async (agentDir) => {
      const commands = new Map<string, any>();
      let activeTools: string[] = [];
      let selectedModel: unknown;

      const models = [
        { id: "executor", provider: "provider" },
        { id: "advisor", provider: "provider" },
      ];

      const theme: SelectorTheme = {
        bold: (value: string) => value,
        fg: (_color: string, value: string) => value,
      };

      const ctx = asExtensionContext({
        cwd: agentDir,
        hasUI: true,
        isProjectTrusted: () => false,
        modelRegistry: modelsRegistry(models),
        ui: typingSelectorUi(theme, { search: "advisor" }),
      });

      registerCommands(
        mockPi(
          { commands },
          {
            getActiveTools: () => activeTools,
            setActiveTools(tools: string[]) {
              activeTools = tools;
            },
            setModel(model: RegistryModel) {
              selectedModel = model;

              return Promise.resolve(true);
            },
            setThinkingLevel: () => {},
          }
        )
      );
      await commands.get("advisor-models").handler("", ctx);
      expect(savedConfig(agentDir)).toMatchObject({
        advisor: "provider/advisor",
      });
      expect(savedConfig(agentDir)).not.toHaveProperty("executor");

      await commands.get("advisor").handler("", ctx);
      expect(selectedModel).toBeUndefined();
      expect(activeTools).toContain("ask_advisor");
    });
  });

  test("opens the model picker before first activation", async () => {
    await withAgentDir({}, async (agentDir) => {
      const { commands, pi, setActiveTools } = activationHarness();
      setActiveTools([]);

      const models = [
        { id: "chosen-executor", provider: "provider" },
        { id: "chosen-advisor", provider: "provider" },
      ];

      const selectedModels: string[] = [];
      const notices: string[] = [];

      const ctx = asExtensionContext({
        cwd: agentDir,
        hasUI: true,
        isProjectTrusted: () => false,
        modelRegistry: modelsRegistry(models),
        ui: {
          ...typingSelectorUi(plainTheme, {
            onValue: (value) => {
              if (value) {
                selectedModels.push(value);
              }
            },
            search: "chosen-advisor",
            searchAt: 0,
          }),
          notify: (message: string) => notices.push(message),
        },
      });

      registerCommands(pi);
      await commands.get("advisor").handler("", ctx);

      expect(selectedModels).toEqual([
        "provider/chosen-advisor",
        "Disabled (no fallback)",
      ]);
      expect(savedConfig(agentDir)).toMatchObject({
        advisor: "provider/chosen-advisor",
      });
      expect(savedConfig(agentDir)).not.toHaveProperty("executor");
      expect(pi.getActiveTools()).toContain("ask_advisor");

      const explanation = notices.find((message) =>
        message.startsWith("The Advisor is")
      );

      expect(explanation).toContain(
        "The Advisor is a second-opinion model that reviews the Executor's context and returns risks, alternatives, and verification steps without changing files or running tools."
      );
      expect(explanation).toContain("Advisor flow ready");
      expect(notices).toHaveLength(1);
      expect(
        explanation?.split("\n\n")[0].match(/[.!?](?=\s|$)/gu)
      ).toHaveLength(1);
    });
  });

  test("keeps available persisted models without opening the picker", async () => {
    await withAgentDir(
      {
        advisor: "provider/advisor",
        executor: "provider/executor",
      },
      async (agentDir) => {
        const { commands, pi, setActiveTools } = activationHarness();
        setActiveTools([]);

        const models = [
          { id: "executor", provider: "provider" },
          { id: "advisor", provider: "provider" },
        ];

        let customCalls = 0;

        const ctx = asExtensionContext({
          cwd: agentDir,
          hasUI: true,
          isProjectTrusted: () => false,
          modelRegistry: modelsRegistry(models),
          ui: {
            custom: () => {
              customCalls += 1;

              return Promise.resolve();
            },
            notify: () => {},
          },
        });

        registerCommands(pi);
        await commands.get("advisor").handler("", ctx);

        expect(customCalls).toBe(0);
        expect(pi.getActiveTools()).toContain("ask_advisor");
      }
    );
  });

  test("opens the picker when a persisted model is unavailable", async () => {
    await withAgentDir(
      {
        advisor: "provider/stale",
        executor: "provider/executor",
      },
      async (agentDir) => {
        const { commands, pi } = activationHarness();

        const models = [
          { id: "replacement", provider: "provider" },
          { id: "executor", provider: "provider" },
        ];

        let customCalls = 0;

        const ctx = asExtensionContext({
          cwd: agentDir,
          hasUI: true,
          isProjectTrusted: () => false,
          modelRegistry: modelsRegistry(models),
          ui: {
            ...typingSelectorUi(plainTheme, {
              onOpen: () => {
                customCalls += 1;
              },
            }),
            select: () => Promise.resolve("✓ Default (Model Default)"),
          },
        });

        registerCommands(pi);
        await commands.get("advisor").handler("", ctx);

        expect(customCalls).toBe(2);
        expect(savedConfig(agentDir)).toMatchObject({
          advisor: "provider/replacement",
          executor: "provider/executor",
        });
        expect(pi.getActiveTools()).toContain("ask_advisor");
      }
    );
  });

  test("cancelled activation does not clear a persistent Advisor-tools opt-out", async () => {
    await withAgentDir({ advisorToolsEnabled: false }, async (agentDir) => {
      const { commands, events, pi, setActiveTools } = activationHarness();
      setActiveTools(["ask_advisor", "record_advisor_outcome"]);

      const ctx = asExtensionContext({
        cwd: agentDir,
        hasUI: true,
        isProjectTrusted: () => false,
        modelRegistry: {
          find: () => {},
          getApiKeyAndHeaders: () =>
            Promise.resolve({ apiKey: "key", ok: true }),
          getAvailable: () => [
            { id: "executor", provider: "provider" },
            { id: "advisor", provider: "provider" },
          ],
        },
        ui: {
          custom: () => Promise.resolve(),
          notify: () => {},
        },
      });

      registerCommands(pi);
      await events.get("session_start")?.({ reason: "startup" }, ctx);
      await commands.get("advisor").handler("", ctx);

      expect(savedConfig(agentDir)).toEqual({ advisorToolsEnabled: false });
      expect(pi.getActiveTools()).toEqual([]);
    });
  });

  test("preselects an inactive /model choice in advisor-models", async () => {
    await withAgentDir(
      { advisor: "provider/sonnet", executor: "provider/sonnet" },
      async (agentDir) => {
        const { commands, events, pi, setActiveTools } = activationHarness();

        const models = [
          { id: "sonnet", provider: "provider" },
          { id: "luna", provider: "provider" },
        ];

        const selectedModels: string[] = [];

        const theme: SelectorTheme = {
          bold: (value: string) => value,
          fg: (_color: string, value: string) => value,
        };

        const ctx = asExtensionContext({
          cwd: agentDir,
          hasUI: true,
          isProjectTrusted: () => false,
          modelRegistry: modelsRegistry(models),
          ui: typingSelectorUi(theme, {
            onValue: (value) => {
              if (value) {
                selectedModels.push(value);
              }
            },
            search: "luna",
          }),
        });

        registerCommands(pi);
        setActiveTools([]);
        await events.get("session_start")?.({ reason: "startup" }, ctx);
        events.get("model_select")?.(
          { model: { id: "luna", provider: "provider" }, source: "set" },
          ctx
        );

        await commands.get("advisor-models").handler("", ctx);
        await commands.get("advisor").handler("", ctx);

        expect(selectedModels).toEqual([
          "provider/luna",
          "provider/luna",
          "Disabled (no fallback)",
        ]);
        expect(savedConfig(agentDir)).toMatchObject({
          advisor: "provider/luna",
          executor: "provider/luna",
        });
      }
    );
  });

  test("reports rather than throws when always-on activation fails", async () => {
    await withAgentDir({ alwaysOn: true }, async (agentDir) => {
      writeFileSync(join(agentDir, "advisor.json"), "{ not json");
      resetConfigCache();
      const { events, pi } = activationHarness();
      registerCommands(pi);
      const notes: string[] = [];
      await events.get("session_start")?.(
        { reason: "startup" },
        activationContext(agentDir, notes)
      );
      expect(notes.join("\n")).toContain("Advisor activation failed");
    });
  });

  test("activates silently for always-on sessions but announces /advisor", async () => {
    const previousChildMarker = process.env.PI_SUBAGENT_CHILD;
    delete process.env.PI_SUBAGENT_CHILD;

    try {
      await withAgentDir(
        {
          advisor: "provider/advisor",
          alwaysOn: true,
          executor: "provider/executor",
        },
        async (agentDir) => {
          const {
            commands,
            events,
            pi,
            selectedModels,
            thinkingLevels,
            setActiveTools,
          } = activationHarness();

          registerCommands(pi);
          const automatic: string[] = [];
          setActiveTools([]);
          await events.get("session_start")?.(
            { reason: "startup" },
            activationContext(agentDir, automatic)
          );
          expect(automatic).toEqual([]);
          expect(pi.getActiveTools()).toContain("ask_advisor");
          expect(selectedModels).toEqual([
            { id: "executor", provider: "provider" },
          ]);
          expect(thinkingLevels).toEqual([]);

          const manual: string[] = [];
          await commands
            .get("advisor")
            .handler("", activationContext(agentDir, manual));
          expect(manual.join("\n")).toContain("Advisor flow ready");
        }
      );
    } finally {
      if (previousChildMarker === undefined) {
        delete process.env.PI_SUBAGENT_CHILD;
      } else {
        process.env.PI_SUBAGENT_CHILD = previousChildMarker;
      }
    }
  });

  test("preserves the host model for marked subagent sessions", async () => {
    const previousChildMarker = process.env.PI_SUBAGENT_CHILD;
    process.env.PI_SUBAGENT_CHILD = "1";

    try {
      await withAgentDir(
        {
          advisor: "provider/advisor",
          alwaysOn: true,
          executor: "provider/executor",
          executorEffort: "high",
        },
        async (agentDir) => {
          const { events, pi, selectedModels, thinkingLevels, setActiveTools } =
            activationHarness();

          registerCommands(pi);
          setActiveTools([]);
          await events.get("session_start")?.(
            { reason: "startup" },
            activationContext(agentDir)
          );
          expect(pi.getActiveTools()).toContain("ask_advisor");
          expect(selectedModels).toEqual([]);
          expect(thinkingLevels).toEqual([]);
        }
      );
    } finally {
      if (previousChildMarker === undefined) {
        delete process.env.PI_SUBAGENT_CHILD;
      } else {
        process.env.PI_SUBAGENT_CHILD = previousChildMarker;
      }
    }
  });

  test("preserves the host model for explicit activation in marked subagents", async () => {
    const previousChildMarker = process.env.PI_SUBAGENT_CHILD;
    process.env.PI_SUBAGENT_CHILD = "1";

    try {
      await withAgentDir(
        {
          advisor: "provider/advisor",
          executor: "provider/executor",
          executorEffort: "high",
        },
        async (agentDir) => {
          const { commands, pi, selectedModels, thinkingLevels } =
            activationHarness();

          registerCommands(pi);
          await commands
            .get("advisor")
            .handler("", activationContext(agentDir));
          expect(selectedModels).toEqual([]);
          expect(thinkingLevels).toEqual([]);
          expect(pi.getActiveTools()).toContain("ask_advisor");
        }
      );
    } finally {
      if (previousChildMarker === undefined) {
        delete process.env.PI_SUBAGENT_CHILD;
      } else {
        process.env.PI_SUBAGENT_CHILD = previousChildMarker;
      }
    }
  });

  test("does not persist marked child model selections", async () => {
    const previousChildMarker = process.env.PI_SUBAGENT_CHILD;
    process.env.PI_SUBAGENT_CHILD = "1";

    try {
      await withAgentDir(
        {
          advisor: "provider/advisor",
          alwaysOn: true,
          executor: "provider/executor",
        },
        async (agentDir) => {
          const { events, pi } = activationHarness();
          registerCommands(pi);
          events.get("model_select")?.(
            {
              model: { id: "host-model", provider: "provider" },
              source: "set",
            },
            activationContext(agentDir)
          );
          expect(savedConfig(agentDir).executor).toBe("provider/executor");
        }
      );
    } finally {
      if (previousChildMarker === undefined) {
        delete process.env.PI_SUBAGENT_CHILD;
      } else {
        process.env.PI_SUBAGENT_CHILD = previousChildMarker;
      }
    }
  });

  test("preserves child agent model and thinking level for in-process subagents without writing advisor.json (D6)", async () => {
    await withAgentDir(
      {
        advisor: "provider/advisor",
        alwaysOn: true,
        executor: "provider/executor",
        executorEffort: "high",
      },
      async (agentDir) => {
        const { events, pi, selectedModels, thinkingLevels, setActiveTools } =
          activationHarness();
        registerCommands(pi);
        setActiveTools([]);
        const childCtx = {
          ...activationContext(agentDir),
          agent: { id: "Task1", kind: "sub" as const },
          model: { id: "child-model", provider: "child-provider" },
          thinkingLevel: "low" as const,
        };
        await events.get("session_start")?.({ reason: "startup" }, childCtx);
        expect(pi.getActiveTools()).toContain("ask_advisor");
        expect(selectedModels).toEqual([]);
        expect(thinkingLevels).toEqual([]);

        await events.get("model_select")?.(
          {
            model: { id: "new-child-model", provider: "provider" },
            source: "set",
          },
          childCtx
        );
        expect(savedConfig(agentDir).executor).toBe("provider/executor");
      }
    );
  });

  test("awaits setActiveTools in /advisor activation and /advisor-off deactivation", async () => {
    await withAgentDir(
      {
        advisor: "provider/advisor",
        executor: "provider/executor",
      },
      async (agentDir) => {
        const commands = new Map<string, any>();
        const activeTools: string[] = [];
        const pi = mockPi(
          { activeTools, commands, deferSetActiveTools: true },
          {
            setModel: () => Promise.resolve(true),
            setThinkingLevel: () => undefined,
          }
        );
        registerCommands(pi);
        const ctx = activationContext(agentDir);

        await commands.get("advisor").handler("", ctx);
        expect(activeTools).toContain("ask_advisor");

        await commands.get("advisor-off").handler("", ctx);
        expect(activeTools).not.toContain("ask_advisor");
      }
    );
  });

  test("hides usage details from automatic gate results when disabled", () => {
    setShowUsageDetailsRef(true);
    const { pi, renderers } = activationHarness();
    registerAdvisorTool(pi);

    const render = () =>
      renderers
        .get("advisor-loop-result")(
          {
            content: [{ text: "Decision: proceed", type: "text" }],
            details: {
              advisor: "test/model",
              decision: "proceed",
              text: "Decision: proceed",
              usage: { cost: 0.0042, input: 50, output: 10 },
            },
          },
          { expanded: false },
          plainTheme
        )
        .render(120)
        .join("\n");

    expect(render()).toContain("Usage: ↑50 · ↓10 · $0.0042");
    setShowUsageDetailsRef(false);

    try {
      expect(render()).not.toContain("Usage:");
    } finally {
      setShowUsageDetailsRef(true);
    }
  });

  test("settings toggle disables and re-enables model-facing Advisor tools", async () => {
    await withAgentDir({}, async (agentDir) => {
      const { commands, pi, setActiveTools } = activationHarness();
      registerCommands(pi);
      setActiveTools(["read", "ask_advisor", "record_advisor_outcome"]);

      const models = modelsRegistry([
        { id: "advisor", provider: "provider" },
        { id: "executor", provider: "provider" },
      ]);

      const ctx = asExtensionContext({
        cwd: agentDir,
        hasUI: true,
        isProjectTrusted: () => false,
        modelRegistry: models,
        ui: {
          custom: (factory: any) =>
            new Promise<void>((resolve) => {
              const selector = factory(
                { requestRender: () => {} },
                plainTheme,
                { matches: () => false },
                () => resolve()
              );

              focusSettingsRow(selector, "Advisor tools");
              selector.handleInput(" ");
              selector.dispose();
              resolve();
            }),
          notify: () => {},
          setStatus: () => {},
        },
      });

      await commands.get("advisor-settings").handler("", ctx);
      expect(savedConfig(agentDir).advisorToolsEnabled).toBe(false);
      expect(pi.getActiveTools()).toEqual(["read"]);

      await commands.get("advisor-settings").handler("", ctx);
      expect(savedConfig(agentDir).advisorToolsEnabled).toBe(true);
      expect(pi.getActiveTools()).toEqual([
        "read",
        "ask_advisor",
        "record_advisor_outcome",
      ]);
    });
  });

  test("keeps tools off in the current session when the settings save fails", async () => {
    await withAgentDir({}, async (agentDir) => {
      const { commands, pi, setActiveTools } = activationHarness();
      registerCommands(pi);
      setActiveTools(["read", "ask_advisor", "record_advisor_outcome"]);
      const notes: string[] = [];

      const ctx = asExtensionContext({
        cwd: agentDir,
        hasUI: true,
        isProjectTrusted: () => false,
        modelRegistry: modelsRegistry([]),
        ui: {
          custom: (factory: any) =>
            new Promise<void>((resolve) => {
              const selector = factory(
                { requestRender: () => {} },
                plainTheme,
                { matches: () => false },
                () => resolve()
              );

              focusSettingsRow(selector, "Advisor tools");
              writeFileSync(join(agentDir, "advisor.json"), "{ invalid");
              selector.handleInput(" ");
              selector.dispose();
              resolve();
            }),
          notify: (message: string) => notes.push(message),
          setStatus: () => {},
        },
      });

      await commands.get("advisor-settings").handler("", ctx);

      expect(pi.getActiveTools()).toEqual(["read"]);
      expect(notes.join("\n")).toContain(
        "tools remain disabled for this session"
      );
    });
  });

  test("blocks stale Advisor tool calls after a persisted opt-out", async () => {
    await withAgentDir({ advisorToolsEnabled: false }, async (agentDir) => {
      const activeTools = ["ask_advisor", "record_advisor_outcome"];
      const events = new Map<string, any>();
      const pi = mockPi({ activeTools, events });
      registerAdvisorTool(pi);
      const toolCall = events.get("tool_call");
      const ctx = activationContext(agentDir);

      expect(
        await toolCall(
          { input: {}, toolCallId: "ask", toolName: "ask_advisor" },
          ctx
        )
      ).toMatchObject({
        block: true,
        reason:
          "Advisor tools are disabled. Enable them in /advisor-settings or run /advisor.",
      });
      expect(
        await toolCall(
          {
            input: {},
            toolCallId: "outcome",
            toolName: "record_advisor_outcome",
          },
          ctx
        )
      ).toMatchObject({
        block: true,
        reason:
          "Advisor tools are disabled. Enable them in /advisor-settings or run /advisor.",
      });
    });
  });

  test("keeps on-demand Advisor tools enabled by default", async () => {
    await withAgentDir({}, async (agentDir) => {
      const { events, pi, setActiveTools } = activationHarness();
      registerCommands(pi);
      setActiveTools(["read", "ask_advisor", "record_advisor_outcome"]);

      await events.get("session_start")?.(
        { reason: "startup" },
        activationContext(agentDir)
      );

      expect(pi.getActiveTools()).toEqual([
        "read",
        "ask_advisor",
        "record_advisor_outcome",
      ]);
    });
  });

  test("explicitly disabled tools take precedence over always-on", async () => {
    await withAgentDir(
      {
        advisor: "provider/advisor",
        advisorToolsEnabled: false,
        alwaysOn: true,
        executor: "provider/executor",
      },
      async (agentDir) => {
        const { events, pi, selectedModels, setActiveTools } =
          activationHarness();

        registerCommands(pi);
        setActiveTools(["read", "ask_advisor", "record_advisor_outcome"]);

        await events.get("session_start")?.(
          { reason: "startup" },
          activationContext(agentDir)
        );

        expect(pi.getActiveTools()).toEqual(["read"]);
        expect(selectedModels).toEqual([]);
      }
    );
  });

  test("/advisor re-enables a persisted tools opt-out after successful activation", async () => {
    await withAgentDir(
      {
        advisor: "provider/advisor",
        advisorToolsEnabled: false,
        executor: "provider/executor",
      },
      async (agentDir) => {
        const { commands, events, pi, setActiveTools } = activationHarness();
        registerCommands(pi);
        setActiveTools(["read", "ask_advisor", "record_advisor_outcome"]);
        const ctx = activationContext(agentDir);
        await events.get("session_start")?.({ reason: "startup" }, ctx);
        expect(pi.getActiveTools()).toEqual(["read"]);

        await commands.get("advisor").handler("", ctx);

        expect(savedConfig(agentDir).advisorToolsEnabled).toBe(true);
        expect(pi.getActiveTools()).toEqual([
          "read",
          "ask_advisor",
          "record_advisor_outcome",
        ]);
      }
    );
  });

  test("/advisor-off wins over an in-flight /advisor activation", async () => {
    await withAgentDir(
      {
        advisor: "provider/advisor",
        executor: "provider/executor",
      },
      async (agentDir) => {
        const { commands, pi, selectedModels, setActiveTools } =
          activationHarness();

        registerCommands(pi);
        setActiveTools(["read", "ask_advisor", "record_advisor_outcome"]);
        let releaseAuth!: (result: { apiKey: string; ok: boolean }) => void;
        let signalAuthStarted!: () => void;

        const authStarted = new Promise<void>((resolve) => {
          signalAuthStarted = resolve;
        });

        const ctx = asExtensionContext({
          cwd: agentDir,
          hasUI: true,
          isProjectTrusted: () => false,
          modelRegistry: {
            find: (provider: string, id: string) => ({ id, provider }),
            getApiKeyAndHeaders: () => {
              signalAuthStarted();

              return new Promise((resolve) => {
                releaseAuth = resolve;
              });
            },
          },
          ui: { notify: () => {} },
        });

        const activation = commands
          .get("advisor")
          .handler("contextMaxChars=5000", ctx);

        await authStarted;
        await commands.get("advisor-off").handler("", ctx);
        releaseAuth({ apiKey: "key", ok: true });
        await activation;

        expect(savedConfig(agentDir)).toMatchObject({
          advisorToolsEnabled: false,
        });
        expect(savedConfig(agentDir).contextMaxChars).toBeUndefined();
        expect(contextMaxCharsRef).toBe(15_000);
        expect(pi.getActiveTools()).toEqual(["read"]);
        expect(selectedModels).toEqual([]);
      }
    );
  });

  test("cancelled activation preserves settings saved while it was waiting", async () => {
    await withAgentDir(
      {
        advisor: "provider/advisor",
        executor: "provider/executor",
      },
      async (agentDir) => {
        const { commands, pi, setActiveTools } = activationHarness();
        registerCommands(pi);
        setActiveTools(["read", "ask_advisor", "record_advisor_outcome"]);

        const models = [
          { id: "advisor", provider: "provider" },
          { id: "executor", provider: "provider" },
        ];

        let releaseAuth!: (result: { apiKey: string; ok: boolean }) => void;
        let signalAuthStarted!: () => void;

        const authStarted = new Promise<void>((resolve) => {
          signalAuthStarted = resolve;
        });

        const modelRegistry = {
          find: (provider: string, id: string) =>
            models.find(
              (model) => model.provider === provider && model.id === id
            ),
          getApiKeyAndHeaders: () => {
            signalAuthStarted();

            return new Promise((resolve) => {
              releaseAuth = resolve;
            });
          },
          getAvailable: () => models,
        };

        const ctx = asExtensionContext({
          cwd: agentDir,
          hasUI: true,
          isProjectTrusted: () => false,
          modelRegistry,
          ui: { notify: () => {} },
        });

        const settingsCtx = asExtensionContext({
          cwd: agentDir,
          hasUI: true,
          isProjectTrusted: () => false,
          modelRegistry,
          ui: {
            custom: (factory: any) =>
              new Promise<void>((resolve) => {
                const selector = factory(
                  { requestRender: () => {} },
                  plainTheme,
                  { matches: () => false },
                  () => resolve()
                );

                focusSettingsRow(selector, "Advisor tools");
                selector.handleInput(" ");
                changeSetting(selector, "Context window");
                selector.dispose();
                resolve();
              }),
            notify: () => {},
            setStatus: () => {},
          },
        });

        const activation = commands
          .get("advisor")
          .handler("contextMaxChars=5000", ctx);

        await authStarted;
        await commands.get("advisor-settings").handler("", settingsCtx);
        expect(savedConfig(agentDir)).toMatchObject({
          advisorToolsEnabled: false,
          contextMaxChars: 25_000,
        });

        releaseAuth({ apiKey: "key", ok: true });
        await activation;

        expect(contextMaxCharsRef).toBe(25_000);
        expect(pi.getActiveTools()).toEqual(["read"]);
      }
    );
  });

  test("failed activation keeps settings saved while it was waiting", async () => {
    await withAgentDir(
      {
        advisor: "provider/advisor",
        executor: "provider/executor",
      },
      async (agentDir) => {
        const { commands, pi, setActiveTools } = activationHarness();
        registerCommands(pi);
        setActiveTools(["read", "ask_advisor", "record_advisor_outcome"]);

        const models = [
          { id: "advisor", provider: "provider" },
          { id: "executor", provider: "provider" },
        ];

        let releaseAuth!: (result: { apiKey: string; ok: boolean }) => void;
        let signalAuthStarted!: () => void;

        const authStarted = new Promise<void>((resolve) => {
          signalAuthStarted = resolve;
        });

        const modelRegistry = {
          find: (provider: string, id: string) =>
            models.find(
              (model) => model.provider === provider && model.id === id
            ),
          getApiKeyAndHeaders: () => {
            signalAuthStarted();

            return new Promise((resolve) => {
              releaseAuth = resolve;
            });
          },
          getAvailable: () => models,
        };

        const ctx = asExtensionContext({
          cwd: agentDir,
          hasUI: true,
          isProjectTrusted: () => false,
          modelRegistry,
          ui: { notify: () => {} },
        });

        const settingsCtx = asExtensionContext({
          cwd: agentDir,
          hasUI: true,
          isProjectTrusted: () => false,
          modelRegistry,
          ui: {
            custom: (factory: any) =>
              new Promise<void>((resolve) => {
                const selector = factory(
                  { requestRender: () => {} },
                  plainTheme,
                  { matches: () => false },
                  () => resolve()
                );

                changeSetting(selector, "Context window");
                selector.dispose();
                resolve();
              }),
            notify: () => {},
            setStatus: () => {},
          },
        });

        const activation = commands
          .get("advisor")
          .handler("contextMaxChars=5000", ctx);

        await authStarted;
        await commands.get("advisor-settings").handler("", settingsCtx);
        expect(savedConfig(agentDir).contextMaxChars).toBe(25_000);

        releaseAuth({ apiKey: "", ok: false });
        await activation;

        expect(contextMaxCharsRef).toBe(25_000);
        expect(savedConfig(agentDir).contextMaxChars).toBe(25_000);
        expect(pi.getActiveTools()).toContain("ask_advisor");
      }
    );
  });

  test("persists /advisor-off when always-on is already false", async () => {
    await withAgentDir({ alwaysOn: false }, async (agentDir) => {
      const { commands, events, pi, setActiveTools } = activationHarness();
      registerCommands(pi);
      setActiveTools(["read", "ask_advisor", "record_advisor_outcome"]);
      const ctx = activationContext(agentDir);
      await events.get("session_start")?.({ reason: "startup" }, ctx);

      await commands.get("advisor-off").handler("", ctx);
      expect(savedConfig(agentDir)).toMatchObject({
        advisorToolsEnabled: false,
        alwaysOn: false,
      });
      expect(pi.getActiveTools()).toEqual(["read"]);

      setActiveTools(["read", "ask_advisor", "record_advisor_outcome"]);
      await events.get("session_start")?.({ reason: "new" }, ctx);
      expect(pi.getActiveTools()).toEqual(["read"]);
    });
  });

  test("turning the Advisor off also clears persistent activation", async () => {
    await withAgentDir(
      {
        advisor: "provider/advisor",
        alwaysOn: true,
        executor: "provider/executor",
      },
      async (agentDir) => {
        const { commands, events, pi, setActiveTools } = activationHarness();
        registerCommands(pi);
        const notes: string[] = [];
        const ctx = activationContext(agentDir, notes);
        await events.get("session_start")?.({ reason: "startup" }, ctx);

        await commands.get("advisor-off").handler("", ctx);
        expect(pi.getActiveTools()).not.toContain("ask_advisor");
        expect(savedConfig(agentDir).alwaysOn).toBe(false);
        expect(savedConfig(agentDir).advisorToolsEnabled).toBe(false);
        expect(notes.at(-1)).toContain("Always on turned off");

        setActiveTools(["read", "ask_advisor", "record_advisor_outcome"]);
        await events.get("session_start")?.({ reason: "new" }, ctx);
        expect(pi.getActiveTools()).toEqual(["read"]);
      }
    );
  });

  test("/advisor-off stays session-disabled if its persistent save fails", async () => {
    await withAgentDir(
      {
        advisor: "provider/advisor",
        alwaysOn: true,
        executor: "provider/executor",
      },
      async (agentDir) => {
        const { commands, events, pi } = activationHarness();
        registerCommands(pi);
        const notes: string[] = [];
        const ctx = activationContext(agentDir, notes);
        await events.get("session_start")?.({ reason: "startup" }, ctx);
        writeFileSync(join(agentDir, "advisor.json"), "{ invalid");
        resetConfigCache();

        await commands.get("advisor-off").handler("", ctx);

        expect(pi.getActiveTools()).not.toContain("ask_advisor");
        expect(notes.at(-1)).toContain("configuration could not be reloaded");
      }
    );
  });

  test("persists context arguments supplied to /advisor", async () => {
    await withAgentDir(
      {
        advisor: "provider/advisor",
        contextMaxChars: 15_000,
        executor: "provider/executor",
      },
      async (agentDir) => {
        const { commands, pi } = activationHarness();
        registerCommands(pi);
        await commands
          .get("advisor")
          .handler("contextMaxChars=5000", activationContext(agentDir));
        expect(savedConfig(agentDir).contextMaxChars).toBe(5000);
        expect(loadConfig(activationContext(agentDir))).toBeTruthy();
        expect(contextMaxCharsRef).toBe(5000);
      }
    );
  });

  test("renders a manual sound verdict exactly like the tool response", async () => {
    await withAgentDir({}, () => {
      const { pi, renderers } = activationHarness();
      registerCommands(pi);

      const render = (text: string) =>
        renderers
          .get("advisor-manual-result")(
            {
              content: text,
              details: {
                advisor: "test/model",
                text,
                usage: { cacheWrite: 3, cost: 0.01, input: 100, output: 20 },
              },
            },
            { expanded: true },
            plainTheme
          )
          .render(120)
          .join("\n");

      expect(render("Verdict: sound\n\nNothing to change.")).toContain(
        "◆ ADVISOR · SOUND"
      );
      expect(render("Verdict: sound\n\nNothing to change.")).toContain(
        "Usage: ↑100 · ↓20 · cw:3 · $0.0100"
      );
      setShowUsageDetailsRef(false);

      try {
        expect(render("Verdict: sound\n\nNothing to change.")).not.toContain(
          "Usage:"
        );
      } finally {
        setShowUsageDetailsRef(true);
      }

      expect(render("Consider reverting the migration.")).toContain(
        "◆ ADVISOR RESPONSE"
      );
    });
  });

  test("deduplicates delimited prompt blocks across OMP retries, preserves foreign headings, and strips only owned block on /advisor-off in real OMP ExtensionRunner (P1, P2, P3)", async () => {
    await withAgentDir(
      {
        advisor: "provider/advisor",
        alwaysOn: true,
        executor: "provider/executor",
        simpleMode: false,
      },
      async (agentDir) => {
        const { commands, events, pi } = activationHarness();
        registerCommands(pi);
        registerAdvisorTool(pi);
        const ctx = activationContext(agentDir);
        await events.get("session_start")?.({ reason: "startup" }, ctx);

        const baseBlocks = [
          "System header",
          "Advisor invocation settings:\n- Foreign extension rule",
          "## Devices\n- xd://ask_advisor",
        ];
        let currentPrompt = [...baseBlocks];
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const outcome = await dispatchBeforeAgentStart(
            events,
            { systemPrompt: currentPrompt },
            ctx
          );
          currentPrompt = Array.isArray(outcome.systemPrompt)
            ? outcome.systemPrompt
            : [];
        }
        expect(currentPrompt).toHaveLength(4);
        expect(currentPrompt.slice(0, 3)).toEqual(baseBlocks);
        expect(currentPrompt[3]).toStartWith(
          "<!-- pi-advisor-flow:invocation-settings:start -->\nAdvisor invocation settings:\n"
        );
        expect(currentPrompt[3]).toEndWith(
          "\n<!-- pi-advisor-flow:invocation-settings:end -->"
        );

        await commands.get("advisor-off").handler("", ctx);
        const removedOutcome = await dispatchBeforeAgentStart(
          events,
          { systemPrompt: currentPrompt },
          ctx
        );
        expect(removedOutcome.result).toEqual({ systemPrompt: baseBlocks });

        const alreadyCleanOutcome = await dispatchBeforeAgentStart(
          events,
          { systemPrompt: baseBlocks },
          ctx
        );
        expect(alreadyCleanOutcome.result).toBeUndefined();
      }
    );

    const bundledEntry = resolvePath(import.meta.dirname, "../dist/index.js");
    const script = `
      import { writeFileSync } from "node:fs";
      import { join } from "node:path";
      import { loadExtensions } from "./packages/coding-agent/src/extensibility/extensions/loader.ts";
      import { ExtensionRunner } from "./packages/coding-agent/src/extensibility/extensions/runner.ts";
      const TOP_LEVEL_AGENT = { id: "main", kind: "main" };
      import { SessionManager } from "./packages/coding-agent/src/session/session-manager.ts";

      const agentDir = process.env.PI_CODING_AGENT_DIR;
      writeFileSync(
        join(agentDir, "advisor.json"),
        JSON.stringify({
          advisor: "provider/advisor",
          advisorCompletionGate: true,
          advisorFailureGate: true,
          advisorPlanGate: true,
          executor: "provider/executor",
          simpleMode: false,
        })
      );
      const loaded = await loadExtensions([${JSON.stringify(bundledEntry)}], process.cwd());
      if (loaded.errors.length > 0) {
        throw new Error(loaded.errors.map((e) => e.error).join("; "));
      }
      let activeTools = ["ask_advisor", "record_advisor_outcome"];
      loaded.runtime.getActiveTools = () => activeTools;
      loaded.runtime.setActiveTools = async (names) => {
        activeTools = [...names];
      };
      const sessionManager = SessionManager.inMemory(process.cwd());
      const runner = new ExtensionRunner(
        loaded.extensions,
        loaded.runtime,
        process.cwd(),
        sessionManager,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        TOP_LEVEL_AGENT
      );
      const baseBlocks = [
        "System header",
        "Advisor invocation settings:\\n- Foreign extension rule",
        "## Devices\\n- xd://ask_advisor",
      ];
      let current = [...baseBlocks];
      for (let i = 0; i < 3; i += 1) {
        const res = await runner.emitBeforeAgentStart("Plan task", undefined, current);
        if (Array.isArray(res?.systemPrompt)) {
          current = res.systemPrompt;
        }
      }
      activeTools = [];
      const afterOff = await runner.emitBeforeAgentStart("Plan task", undefined, current);
      const afterClean = await runner.emitBeforeAgentStart("Plan task", undefined, baseBlocks);
      console.log(JSON.stringify({
        afterCleanSystemPrompt: afterClean?.systemPrompt ?? null,
        afterOffSystemPrompt: afterOff?.systemPrompt ?? null,
        retryLength: current.length,
        retryOwnedBlock: current[3] ?? "",
        retryPrefix: current.slice(0, 3),
      }));
    `;
    const ompResult = await runOmpScript(
      "omp-before-agent-start-",
      script,
      // SAFETY: The isolated OMP subprocess writes a single JSON summary line matching OmpPromptProbeOutput.
      (line) => JSON.parse(line) as OmpPromptProbeOutput
    );
    expect(ompResult.retryLength).toBe(4);
    expect(ompResult.retryPrefix).toEqual([
      "System header",
      "Advisor invocation settings:\n- Foreign extension rule",
      "## Devices\n- xd://ask_advisor",
    ]);
    expect(ompResult.retryOwnedBlock).toContain(
      "<!-- pi-advisor-flow:invocation-settings:start -->"
    );
    expect(ompResult.retryOwnedBlock).toContain("xd://ask_advisor");
    expect(ompResult.afterOffSystemPrompt).toEqual(ompResult.retryPrefix);
    expect(ompResult.afterCleanSystemPrompt).toBeNull();
  });
  test("keeps available persisted models without opening the picker with advisor-on", async () => {
    await withAgentDir(
      {
        advisor: "provider/advisor",
        executor: "provider/executor",
      },
      async (agentDir) => {
        const { commands, pi, selectedModels, setActiveTools } =
          activationHarness();
        setActiveTools(["unrelated-tool"]);
        const models = [
          { id: "executor", provider: "provider" },
          { id: "advisor", provider: "provider" },
        ];
        let customCalls = 0;
        const ctx = asExtensionContext({
          cwd: agentDir,
          hasUI: true,
          isProjectTrusted: () => false,
          modelRegistry: modelsRegistry(models),
          ui: {
            custom: () => {
              customCalls += 1;
              return Promise.resolve();
            },
            notify: () => undefined,
          },
        });

        registerCommands(pi);
        await commands.get("advisor-on").handler("", ctx);

        expect(customCalls).toBe(0);
        expect(selectedModels).toEqual([
          { id: "executor", provider: "provider" },
        ]);
        expect(pi.getActiveTools()).toEqual([
          "unrelated-tool",
          "ask_advisor",
          "record_advisor_outcome",
        ]);
      }
    );
  });

  test("awaits setActiveTools in /advisor-on activation", async () => {
    await withAgentDir(
      {
        advisor: "provider/advisor",
        executor: "provider/executor",
      },
      async (agentDir) => {
        const { promise: toolsBarrier, resolve: releaseTools } =
          Promise.withResolvers<undefined>();
        const { promise: reachedMutation, resolve: signalMutationReached } =
          Promise.withResolvers<undefined>();
        let toolsSettled = false;
        const activeTools: string[] = ["preexisting-tool"];
        const commands = new Map<string, any>();
        const pi = mockPi(
          { activeTools, commands },
          {
            getActiveTools: () => [...activeTools],
            setActiveTools: async (tools: string[]) => {
              signalMutationReached(undefined);
              await toolsBarrier;
              activeTools.length = 0;
              activeTools.push(...tools);
              toolsSettled = true;
            },
            setModel: () => Promise.resolve(true),
            setThinkingLevel: () => undefined,
          }
        );
        registerCommands(pi);
        const ctx = activationContext(agentDir);

        let handlerSettled = false;
        const activationPromise = commands
          .get("advisor-on")
          .handler("", ctx)
          .then(() => {
            expect(toolsSettled).toBe(true);
            handlerSettled = true;
          });

        await reachedMutation;
        expect(handlerSettled).toBe(false);
        expect(toolsSettled).toBe(false);

        releaseTools(undefined);
        await activationPromise;

        expect(handlerSettled).toBe(true);
        expect(toolsSettled).toBe(true);
        expect(activeTools).toEqual([
          "preexisting-tool",
          "ask_advisor",
          "record_advisor_outcome",
        ]);
      }
    );
  });

  test("opens model picker and persists choices on first activation with advisor-on", async () => {
    await withAgentDir({}, async (agentDir) => {
      const { commands, pi, setActiveTools } = activationHarness();
      setActiveTools([]);
      const models = [
        { id: "chosen-executor", provider: "provider" },
        { id: "chosen-advisor", provider: "provider" },
      ];
      const selectedModels: string[] = [];
      const notices: string[] = [];
      const ctx = asExtensionContext({
        cwd: agentDir,
        hasUI: true,
        isProjectTrusted: () => false,
        modelRegistry: modelsRegistry(models),
        ui: {
          ...typingSelectorUi(plainTheme, {
            onValue: (value) => {
              if (value) {
                selectedModels.push(value);
              }
            },
            search: "chosen-advisor",
            searchAt: 0,
          }),
          notify: (message: string) => notices.push(message),
        },
      });

      registerCommands(pi);
      await commands.get("advisor-on").handler("", ctx);

      expect(selectedModels).toEqual([
        "provider/chosen-advisor",
        "Disabled (no fallback)",
      ]);
      expect(savedConfig(agentDir)).toMatchObject({
        advisor: "provider/chosen-advisor",
      });
      expect(savedConfig(agentDir)).not.toHaveProperty("executor");
      expect(pi.getActiveTools()).toEqual([
        "ask_advisor",
        "record_advisor_outcome",
      ]);
      const explanation = notices.find((message) =>
        message.startsWith("The Advisor is")
      );
      expect(explanation).toContain("Advisor flow ready");
    });
  });

  test("persists context arguments and model overrides supplied to /advisor-on", async () => {
    await withAgentDir(
      {
        advisor: "provider/initial-advisor",
        contextMaxChars: 15_000,
        executor: "provider/initial-executor",
      },
      async (agentDir) => {
        const { commands, pi, selectedModels, setActiveTools } =
          activationHarness();
        setActiveTools([]);
        registerCommands(pi);
        const ctx = activationContext(agentDir);
        await commands
          .get("advisor-on")
          .handler(
            "executor=provider/explicit advisor=provider/advisor contextMaxChars=5000",
            ctx
          );
        const saved = savedConfig(agentDir);
        expect(saved.executor).toBe("provider/explicit");
        expect(saved.advisor).toBe("provider/advisor");
        expect(saved.contextMaxChars).toBe(5000);
        expect(selectedModels).toEqual([
          { id: "explicit", provider: "provider" },
        ]);
        expect(pi.getActiveTools()).toEqual([
          "ask_advisor",
          "record_advisor_outcome",
        ]);
        expect(loadConfig(ctx)).toBeTruthy();
        expect(contextMaxCharsRef).toBe(5000);
      }
    );
  });

  test("cancels first activation with advisor-on without persisting or enabling the flow", async () => {
    await withAgentDir({}, async (agentDir) => {
      const { commands, pi, setActiveTools } = activationHarness();
      setActiveTools([]);
      const ctx = asExtensionContext({
        cwd: agentDir,
        hasUI: true,
        isProjectTrusted: () => false,
        modelRegistry: {
          find: () => undefined,
          getApiKeyAndHeaders: () =>
            Promise.resolve({ apiKey: "key", ok: true }),
          getAvailable: () => [
            { id: "executor", provider: "provider" },
            { id: "advisor", provider: "provider" },
          ],
        },
        ui: {
          custom: () => Promise.resolve(),
          notify: () => undefined,
        },
      });

      registerCommands(pi);
      await commands.get("advisor-on").handler("", ctx);

      expect(savedConfig(agentDir)).toEqual({});
      expect(pi.getActiveTools()).toEqual([]);
    });
  });
});
