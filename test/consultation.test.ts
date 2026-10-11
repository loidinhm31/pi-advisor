import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import {
  fauxAssistantMessage,
  registerFauxProvider,
} from "@earendil-works/pi-ai/compat";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { BeforeAgentStartEvent } from "@earendil-works/pi-coding-agent";

import registerExtension, {
  consultAdvisor,
  runAdvisorGate,
} from "../extensions/index.ts";
import {
  setAdvisorRedactSecretsRef,
  setAdvisorScoutEnabledRef,
  setAdvisorToolPoliciesRef,
} from "../src/config.ts";
import { setAdvisorScoutTimeoutMsRef } from "../src/config/state.ts";
import { loadConfig } from "../src/config/storage.ts";
import { DEFAULT_SCOUT_TIMEOUT_MS } from "../src/config/types.ts";
import { HerdrAdvisorBlock } from "../src/herdr-block.ts";
import { herdrAdvisorActivity } from "../src/herdr.ts";
import { AdvisorSessionState } from "../src/session-state.ts";
import { advisorRequestConversation } from "../src/tools.ts";
import { handleAutomaticGate } from "../src/tools/loop-gate.ts";
import { ScoutStatusManager } from "../src/tools/scout-status.ts";
import { withAgentDir } from "./helpers/config-fixture.ts";
import { asExtensionContext } from "./helpers/extension-context.ts";
import { dispatchBeforeAgentStart } from "./helpers/harness.ts";
import type { DualHostEventHandler } from "./helpers/harness.ts";
import { mockPi } from "./helpers/mock-pi.ts";

type PromptSections = BeforeAgentStartEvent["systemPromptOptions"]["sections"];

const registerBeforeAgentStart = (activeTools = ["ask_advisor"]) => {
  const events = new Map<string, DualHostEventHandler>();
  registerExtension(
    mockPi(
      { activeTools, events },
      {
        registerTool: () => undefined,
      }
    )
  );
  return events;
};

const fauxContext = (
  cwd: string,
  faux: any,
  entries: object[] = [],
  trusted = false
) =>
  asExtensionContext({
    cwd,
    isProjectTrusted: () => trusted,
    modelRegistry: {
      find: () => faux.models[0],
      getApiKeyAndHeaders: () => Promise.resolve({ apiKey: "key", ok: true }),
    },
    sessionManager: {
      buildContextEntries: () => entries,
      getBranch: () => entries,
    },
  });

describe("Advisor consultation request construction", () => {
  test("forwards trusted project and global AGENTS.md context with byte accounting", async () => {
    const captured: string[] = [];
    const faux = registerFauxProvider({
      api: "pi-advisor-agents-context-test",
      models: [{ id: "advisor", input: ["text"] }],
      provider: "pi-advisor-agents-context-test",
    });
    try {
      await withAgentDir(
        {
          advisor: "pi-advisor-agents-context-test/advisor",
          advisorAgentsMdContext: true,
          advisorGitContext: "off",
        },
        async (agentDir) => {
          const project = mkdtempSync(join(tmpdir(), "pi-advisor-project-"));
          writeFileSync(join(project, "AGENTS.md"), "project conventions");
          writeFileSync(join(agentDir, "AGENTS.md"), "global conventions");
          try {
            faux.setResponses([
              (context) => {
                captured.push(JSON.stringify(context.messages));
                return fauxAssistantMessage("Advice");
              },
            ]);
            const result = await consultAdvisor(
              fauxContext(project, faux, [], true)
            );
            expect(captured[0]).toContain("<project_rules");
            expect(captured[0]).toContain("[project AGENTS.md]");
            expect(captured[0]).toContain("[global AGENTS.md]");
            expect(result.agentRulesBytes).toBeGreaterThan(0);
          } finally {
            rmSync(project, { force: true, recursive: true });
          }
        }
      );
    } finally {
      faux.unregister();
    }
  });

  test("omits AGENTS.md context when the setting is disabled", async () => {
    const captured: string[] = [];
    const faux = registerFauxProvider({
      api: "pi-advisor-agents-disabled-test",
      models: [{ id: "advisor", input: ["text"] }],
      provider: "pi-advisor-agents-disabled-test",
    });
    try {
      await withAgentDir(
        {
          advisor: "pi-advisor-agents-disabled-test/advisor",
          advisorAgentsMdContext: false,
          advisorGitContext: "off",
        },
        async (agentDir) => {
          const project = mkdtempSync(join(tmpdir(), "pi-advisor-project-"));
          writeFileSync(join(project, "AGENTS.md"), "project conventions");
          writeFileSync(join(agentDir, "AGENTS.md"), "global conventions");
          try {
            faux.setResponses([
              (context) => {
                captured.push(JSON.stringify(context.messages));
                return fauxAssistantMessage("Advice");
              },
            ]);
            const result = await consultAdvisor(
              fauxContext(project, faux, [], true)
            );
            expect(captured[0]).not.toContain("<project_rules");
            expect(result.agentRulesBytes).toBeUndefined();
          } finally {
            rmSync(project, { force: true, recursive: true });
          }
        }
      );
    } finally {
      faux.unregister();
    }
  });

  test("applies redaction at the Advisor request-context boundary", () => {
    const secret = "AKIAABCDEFGHIJKLMNOP";
    const ctx = asExtensionContext({
      sessionManager: {
        getBranch: () => [
          {
            message: { content: `api_key=${secret}`, role: "user" },
            type: "message",
          },
          {
            message: {
              content: secret,
              role: "toolResult",
              toolName: "custom",
            },
            type: "message",
          },
        ],
      },
    });
    setAdvisorRedactSecretsRef(true);
    setAdvisorToolPoliciesRef({});
    try {
      const context = advisorRequestConversation(ctx);
      expect(context).not.toContain(secret);
      expect(context).toContain("[REDACTED SECRET]");
    } finally {
      setAdvisorRedactSecretsRef(false);
      setAdvisorToolPoliciesRef({});
    }
  });

  test("fails automatic gates closed for terminal provider failures", async () => {
    const faux = registerFauxProvider({
      api: "pi-advisor-gate-test",
      models: [{ id: "advisor", input: ["text"] }],
      provider: "pi-advisor-gate-test",
    });
    try {
      await withAgentDir(
        {
          advisor: "pi-advisor-gate-test/advisor",
          advisorGitContext: "off",
        },
        async (agentDir) => {
          faux.setResponses([
            () =>
              fauxAssistantMessage("Decision: proceed", {
                errorMessage: "provider unavailable",
                stopReason: "error",
              }),
            () =>
              fauxAssistantMessage("Decision: proceed", {
                errorMessage: "provider aborted",
                stopReason: "aborted",
              }),
          ]);
          const context = fauxContext(agentDir, faux);
          const outcomes = await Promise.all([
            runAdvisorGate(context, "Review the repeated action."),
            runAdvisorGate(context, "Review the repeated action."),
          ]);
          expect(outcomes).toMatchObject([
            {
              category: "provider-error",
              message: "provider unavailable",
              ok: false,
            },
            {
              category: "provider-error",
              message: "provider aborted",
              ok: false,
            },
          ]);
        }
      );
    } finally {
      faux.unregister();
    }
  });

  test("blocks repeated tool calls when registry auth fails in the gate", async () => {
    const previousEnvValue = process.env.PI_ADVISOR_TEST_MISSING_GATE_KEY;
    delete process.env.PI_ADVISOR_TEST_MISSING_GATE_KEY;
    const notifications: string[] = [];
    const blockedEvents: boolean[] = [];
    try {
      await withAgentDir(
        {
          advisor: "provider/advisor",
          advisorAutoLoopGate: true,
          advisorGitContext: "off",
          advisorLoopThreshold: 2,
          advisorScoutEnabled: false,
          gateFailureMode: "block-session",
        },
        async (agentDir) => {
          const runtime = await ModelRuntime.create({
            credentials: new InMemoryCredentialStore(),
            modelsPath: null,
            refreshOnCreate: false,
          });
          const registry = new ModelRegistry(runtime);
          let providerCalled = false;
          registry.registerProvider("provider", {
            api: "test-api",
            apiKey: "$PI_ADVISOR_TEST_MISSING_GATE_KEY",
            models: [
              {
                api: "test-api",
                baseUrl: "https://example.test",
                contextWindow: 1000,
                cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
                id: "executor",
                input: ["text"],
                maxTokens: 100,
                name: "Executor",
                reasoning: false,
              },
              {
                api: "test-api",
                baseUrl: "https://example.test",
                contextWindow: 1000,
                cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
                id: "advisor",
                input: ["text"],
                maxTokens: 100,
                name: "Advisor",
                reasoning: true,
              },
            ],
            streamSimple: () => {
              providerCalled = true;
              throw new Error("Provider wrapper should not run without auth.");
            },
          });
          const executor = registry.find("provider", "executor");
          if (!executor) {
            throw new Error("Test Executor model was not registered.");
          }
          const context = asExtensionContext({
            abort: () => {},
            cwd: agentDir,
            hasUI: true,
            isProjectTrusted: () => false,
            mode: "json",
            model: executor,
            modelRegistry: registry,
            sessionManager: {
              buildContextEntries: () => [],
              getBranch: () => [],
            },
            ui: {
              notify: (message: string) => notifications.push(message),
              setStatus: () => {},
            },
          });
          loadConfig(context);
          const session = new AdvisorSessionState();
          const sent: { message: any; options: any }[] = [];
          const pi = mockPi({ sent });
          const herdrBlock = new HerdrAdvisorBlock(
            () => {},
            () => true,
            (active) => blockedEvents.push(active)
          );
          const event = {
            input: { command: "echo repeated" },
            toolName: "bash" as const,
            type: "tool_call" as const,
          };
          const runGate = (toolCallId: string) =>
            handleAutomaticGate(
              pi,
              { ...event, toolCallId },
              context,
              session,
              runAdvisorGate,
              new ScoutStatusManager(false),
              herdrAdvisorActivity.createScope(),
              herdrBlock
            );
          expect(await runGate("first-gate-call")).toBeUndefined();
          const effect = await runGate("second-gate-call");
          expect(effect).toMatchObject({
            block: true,
            reason: expect.stringContaining("Advisor gate provider-error"),
          });
          expect(session.blocked).toBe(true);
          expect(blockedEvents).toEqual([true]);
          expect(notifications[0]).toContain(
            "Advisor gate failure; session blocked"
          );
          expect(
            sent.some(({ message }) =>
              message.content.includes("Advisor gate failure (provider-error)")
            )
          ).toBe(true);
          expect(providerCalled).toBe(false);
        }
      );
    } finally {
      if (previousEnvValue === undefined) {
        delete process.env.PI_ADVISOR_TEST_MISSING_GATE_KEY;
      } else {
        process.env.PI_ADVISOR_TEST_MISSING_GATE_KEY = previousEnvValue;
      }
    }
  });

  test("redacts targeted questions before the provider request", async () => {
    const captured: string[] = [];
    const faux = registerFauxProvider({
      api: "pi-advisor-redaction-test",
      models: [{ id: "advisor", input: ["text"] }],
      provider: "pi-advisor-redaction-test",
    });
    try {
      await withAgentDir(
        {
          advisor: "pi-advisor-redaction-test/advisor",
          advisorGitContext: "off",
          advisorRedactSecrets: true,
        },
        async (agentDir) => {
          faux.setResponses([
            (context) => {
              captured.push(JSON.stringify(context.messages));
              return fauxAssistantMessage("Advice");
            },
          ]);
          const result = await consultAdvisor(
            fauxContext(agentDir, faux),
            "password=hunter2"
          );
          expect(result.markdown).toBe("Advice");
        }
      );
    } finally {
      faux.unregister();
    }
    expect(captured).toHaveLength(1);
    expect(captured[0]).not.toContain("hunter2");
    expect(captured[0]).toContain("[REDACTED SECRET]");
  });

  test("completes the Advisor call with legacy context after a real Scout timeout", async () => {
    const faux = registerFauxProvider({
      api: "pi-advisor-scout-timeout-test",
      models: [{ id: "advisor", input: ["text"] }],
      provider: "pi-advisor-scout-timeout-test",
    });
    try {
      await withAgentDir(
        {
          advisor: "pi-advisor-scout-timeout-test/advisor",
          advisorGitContext: "off",
          advisorScoutEnabled: true,
          advisorScoutTimeoutMs: 20,
          executor: "pi-advisor-scout-timeout-test/advisor",
        },
        async (agentDir) => {
          const entries = [
            {
              id: "user-entry",
              message: {
                content: "Original context should remain available.",
                role: "user",
              },
              parentId: null,
              timestamp: "2026-01-01T00:00:00Z",
              type: "message",
            },
          ];
          let advisorRequest = "";
          faux.setResponses([
            (_context, options) =>
              new Promise((resolve, reject) => {
                const signal = options?.signal;
                if (!signal) {
                  reject(new Error("Scout response must be abortable"));
                  return;
                }
                const complete = () =>
                  resolve(
                    fauxAssistantMessage('{"selectedIds":[],"synthesis":""}')
                  );
                if (signal.aborted) {
                  complete();
                } else {
                  signal.addEventListener("abort", complete, { once: true });
                }
              }),
            (context) => {
              advisorRequest = JSON.stringify(context.messages);
              return fauxAssistantMessage(
                "Advisor completed after Scout timeout."
              );
            },
          ]);
          const scoutFallbacks: string[] = [];
          const result = await consultAdvisor(
            fauxContext(agentDir, faux, entries),
            "Continue with the original conversation.",
            undefined,
            undefined,
            "executor-requested",
            undefined,
            undefined,
            undefined,
            undefined,
            (event) => {
              if (event.type === "fallback") {
                scoutFallbacks.push(event.outcome.message);
              }
            }
          );
          expect(result.markdown).toBe(
            "Advisor completed after Scout timeout."
          );
          expect(result.scout).toMatchObject({
            category: "timeout",
            message: "Scout timed out after 20 ms.",
            ok: false,
          });
          expect(scoutFallbacks).toEqual(["Scout timed out after 20 ms."]);
          expect(advisorRequest).toContain(
            "User: Original context should remain available."
          );
          expect(faux.state.callCount).toBe(2);
        }
      );
    } finally {
      faux.unregister();
      setAdvisorScoutEnabledRef(false);
      setAdvisorScoutTimeoutMsRef(DEFAULT_SCOUT_TIMEOUT_MS);
    }
  });

  test("injects only the enabled invocation rules and conditional routing into Pi sections and OMP systemPrompt arrays (P1, P2, P3)", async () => {
    const defaultEvents = registerBeforeAgentStart();
    const ctx = asExtensionContext({
      cwd: tmpdir(),
      getSystemPrompt: () => "Base prompt",
      isProjectTrusted: () => false,
    });
    const foreignBlock =
      "Advisor invocation settings:\n- Foreign extension rule";
    const baseOmpPrompt = [
      "System header",
      foreignBlock,
      "## Devices\n- xd://ask_advisor",
    ];

    await withAgentDir(
      {
        advisorCompletionGate: true,
        advisorFailureGate: true,
        advisorMaxCallsPerSession: 3,
        advisorPlanGate: true,
        simpleMode: false,
      },
      async () => {
        const events = defaultEvents;
        const ompOutcome = await dispatchBeforeAgentStart(
          events,
          { systemPrompt: [...baseOmpPrompt] },
          ctx
        );
        const ompPrompt = ompOutcome.result?.systemPrompt;
        expect(Array.isArray(ompPrompt)).toBe(true);
        if (!Array.isArray(ompPrompt)) {
          throw new TypeError("Expected OMP systemPrompt array result");
        }
        expect(ompPrompt.slice(0, 3)).toEqual(baseOmpPrompt);
        const ownedBlock = ompPrompt[3] ?? "";
        expect(
          ownedBlock.startsWith(
            "<!-- pi-advisor-flow:invocation-settings:start -->\nAdvisor invocation settings:\n"
          )
        ).toBe(true);
        expect(
          ownedBlock.endsWith(
            "\n<!-- pi-advisor-flow:invocation-settings:end -->"
          )
        ).toBe(true);
        expect(ownedBlock).toContain("materially consequential plan");
        expect(ownedBlock).toContain(
          "two consecutive materially equivalent failed attempts"
        );
        expect(ownedBlock).toContain("Before declaring success");
        expect(ownedBlock).toContain("xd://ask_advisor");
        expect(ownedBlock).toContain("ask_advisor");
        expect(ownedBlock).toContain("xd://record_advisor_outcome");
        expect(ownedBlock).toContain("record_advisor_outcome");
        expect(ownedBlock).toContain(
          "Advisor calls remaining this session: 3."
        );
      }
    );

    await withAgentDir(
      {
        advisorCompletionGate: false,
        advisorCustomInvocation: "a deployment changes production data",
        advisorFailureGate: true,
        advisorPlanGate: false,
        simpleMode: false,
      },
      async () => {
        const events = registerBeforeAgentStart();
        const sections: PromptSections = {
          mcp_servers: "<mcp_servers>servers</mcp_servers>",
        };
        const piOutcome = await dispatchBeforeAgentStart(
          events,
          { systemPromptOptions: { sections } },
          ctx
        );
        const prompt = sections.advisor_invocation_settings ?? "";
        expect(piOutcome.result).toBeUndefined();
        expect(sections.mcp_servers).toBe("<mcp_servers>servers</mcp_servers>");
        expect(prompt).toStartWith("Advisor invocation settings:");
        expect(prompt).toContain(
          "two consecutive materially equivalent failed attempts"
        );
        expect(prompt).toContain("a deployment changes production data");
        expect(prompt).toContain("xd://ask_advisor");
        expect(prompt).toContain("ask_advisor");
        expect(prompt).not.toContain("materially consequential plan");
        expect(prompt).not.toContain("Before declaring success");

        const ompOutcome = await dispatchBeforeAgentStart(
          events,
          { systemPrompt: [...baseOmpPrompt] },
          ctx
        );
        const ompOwned = Array.isArray(ompOutcome.result?.systemPrompt)
          ? (ompOutcome.result.systemPrompt[3] ?? "")
          : "";
        expect(ompOwned).toContain(
          "two consecutive materially equivalent failed attempts"
        );
        expect(ompOwned).toContain("a deployment changes production data");
        expect(ompOwned).not.toContain("materially consequential plan");
        expect(ompOwned).not.toContain("Before declaring success");
      }
    );

    await withAgentDir(
      {
        advisorCompletionGate: true,
        advisorFailureGate: true,
        advisorMaxCallsPerSession: 3,
        advisorPlanGate: true,
        simpleMode: true,
      },
      async () => {
        const events = registerBeforeAgentStart();
        const ompOutcome = await dispatchBeforeAgentStart(
          events,
          { systemPrompt: [...baseOmpPrompt] },
          ctx
        );
        const ompOwned = Array.isArray(ompOutcome.result?.systemPrompt)
          ? (ompOutcome.result.systemPrompt[3] ?? "")
          : "";
        expect(ompOwned).toContain("When uncertain");
        expect(ompOwned).toContain("xd://ask_advisor");
        expect(ompOwned).toContain("ask_advisor");
        expect(ompOwned).not.toContain("materially consequential plan");
        expect(ompOwned).not.toContain(
          "two consecutive materially equivalent failed attempts"
        );
        expect(ompOwned).not.toContain("Before declaring success");
        expect(ompOwned).not.toContain("Advisor calls remaining this session:");
      }
    );
  });

  test("ignores missing prompt options, warns once on unsupported prompt shape, and fails open on invalid advisor.json (P4)", async () => {
    await withAgentDir({}, async (agentDir) => {
      const events = new Map<string, DualHostEventHandler>();
      const notifications: { level: string; message: string }[] = [];
      registerExtension(
        mockPi(
          { activeTools: ["ask_advisor"], events },
          {
            registerTool: () => undefined,
          }
        )
      );
      const ctx = asExtensionContext({
        cwd: agentDir,
        hasUI: true,
        isProjectTrusted: () => false,
        ui: {
          notify: (message: string, level: string) => {
            notifications.push({ level, message });
          },
        },
      });

      const emptyEventOutcome = await dispatchBeforeAgentStart(events, {}, ctx);
      expect(emptyEventOutcome.result).toBeUndefined();
      const emptyOptionsOutcome = await dispatchBeforeAgentStart(
        events,
        { systemPromptOptions: {} },
        ctx
      );
      expect(emptyOptionsOutcome.result).toBeUndefined();
      const nullOptionsOutcome = await dispatchBeforeAgentStart(
        events,
        { systemPromptOptions: null },
        ctx
      );
      expect(nullOptionsOutcome.result).toBeUndefined();
      expect(notifications).toHaveLength(0);

      const firstUnsupported = await dispatchBeforeAgentStart(
        events,
        { systemPrompt: "legacy-flat-string-without-sections" },
        ctx
      );
      expect(firstUnsupported.result).toBeUndefined();
      const secondUnsupported = await dispatchBeforeAgentStart(
        events,
        { systemPrompt: "second-unsupported-call" },
        ctx
      );
      expect(secondUnsupported.result).toBeUndefined();
      expect(notifications).toHaveLength(1);
      expect(notifications[0]?.level).toBe("warning");
      expect(notifications[0]?.message).toContain(
        "prompt container is unsupported"
      );

      const seedOutcome = await dispatchBeforeAgentStart(
        events,
        {
          systemPrompt: [
            "System header",
            "Advisor invocation settings:\n- Foreign rule",
          ],
        },
        ctx
      );
      const seededPrompt = Array.isArray(seedOutcome.result?.systemPrompt)
        ? seedOutcome.result.systemPrompt
        : [];
      expect(seededPrompt).toHaveLength(3);

      writeFileSync(
        join(agentDir, "advisor.json"),
        JSON.stringify({ simpleMode: "invalid" })
      );
      const invalidOmpOutcome = await dispatchBeforeAgentStart(
        events,
        { systemPrompt: seededPrompt },
        ctx
      );
      expect(invalidOmpOutcome.result).toEqual({
        systemPrompt: [
          "System header",
          "Advisor invocation settings:\n- Foreign rule",
        ],
      });
      expect(notifications).toHaveLength(2);
      expect(notifications[1]?.level).toBe("error");
      expect(notifications[1]?.message).toContain("Fix advisor.json");
    });
  });

  test("removes only the plugin-owned invocation block when ask_advisor is inactive (P1, P2)", async () => {
    await withAgentDir({ advisorFailureGate: true }, async () => {
      const events = new Map<string, DualHostEventHandler>();
      registerExtension(
        mockPi(
          { activeTools: [], events },
          {
            registerTool: () => undefined,
          }
        )
      );
      const ctx = asExtensionContext({
        cwd: tmpdir(),
        isProjectTrusted: () => false,
      });
      const sections: PromptSections = {
        advisor_invocation_settings: "stale",
        mcp_servers: "servers",
      };
      await dispatchBeforeAgentStart(
        events,
        { systemPromptOptions: { sections } },
        ctx
      );
      expect(sections).toEqual({ mcp_servers: "servers" });

      const cleanPrompt = [
        "System header",
        "Advisor invocation settings:\n- Foreign extension rule",
      ];
      const cleanOutcome = await dispatchBeforeAgentStart(
        events,
        { systemPrompt: cleanPrompt },
        ctx
      );
      expect(cleanOutcome.result).toBeUndefined();

      const staleOwnedBlock = [
        "<!-- pi-advisor-flow:invocation-settings:start -->",
        "Advisor invocation settings:\n- Stale plugin rule",
        "<!-- pi-advisor-flow:invocation-settings:end -->",
      ].join("\n");
      const dirtyOutcome = await dispatchBeforeAgentStart(
        events,
        { systemPrompt: [...cleanPrompt, staleOwnedBlock] },
        ctx
      );
      expect(dirtyOutcome.result).toEqual({ systemPrompt: cleanPrompt });
    });
  });
});
