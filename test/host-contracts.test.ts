import { describe, expect, test } from "bun:test";
import { resolve as resolvePath } from "node:path";

import { hasOmpAgentIdentity } from "../src/child-session.ts";
import {
  hasSettingsListPublicContract,
  isHostSymbolTheme,
  runOmpHostProbe,
  runPiHostProbe,
} from "./helpers/dual-host-harness.ts";
import type {
  OmpHostProbeResult,
  PiHostProbeResult,
} from "./helpers/dual-host-harness.ts";
import {
  dispatchBeforeAgentStart,
  dispatchHostSettlement,
} from "./helpers/harness.ts";
import type { DualHostEventHandler } from "./helpers/harness.ts";
import {
  hasOmpExecutable,
  runIsolatedOmpPluginLink,
} from "./helpers/isolated-omp-plugin-link.ts";
import { mockPi } from "./helpers/mock-pi.ts";

const BUNDLED_ENTRY = resolvePath(import.meta.dirname, "../dist/index.js");

const EXPECTED_COMMANDS = [
  "advisor",
  "advisor-manual",
  "advisor-models",
  "advisor-off",
  "advisor-on",
  "advisor-settings",
  "advisor-stats",
];

const EXPECTED_TOOLS = ["ask_advisor", "record_advisor_outcome"];

describe("dual-host capability and loader contracts (Phase 01 / H1)", () => {
  let probesPromise:
    | Promise<[PiHostProbeResult, OmpHostProbeResult]>
    | undefined;
  const loadHostProbes = () => {
    probesPromise ??= Promise.all([runPiHostProbe(), runOmpHostProbe()]);
    return probesPromise;
  };

  test("loads built dist/index.js in isolated Pi 1.x and OMP subprocesses with full registration parity", async () => {
    const [piProbe, ompProbe] = await loadHostProbes();
    expect(piProbe.isolatedHomeVerified).toBe(true);
    expect(ompProbe.isolatedHomeVerified).toBe(true);
    expect(piProbe.isolatedHome).not.toBe(ompProbe.isolatedHome);

    expect(piProbe.resolvedPath).toBe(BUNDLED_ENTRY);
    expect(ompProbe.resolvedPath).toBe(BUNDLED_ENTRY);

    expect(piProbe.commands).toEqual(EXPECTED_COMMANDS);
    expect(ompProbe.commands).toEqual(EXPECTED_COMMANDS);
    expect(piProbe.tools).toEqual(EXPECTED_TOOLS);
    expect(ompProbe.tools).toEqual(EXPECTED_TOOLS);

    for (const requiredEvent of [
      "before_agent_start",
      "input",
      "session_shutdown",
      "session_start",
      "tool_call",
      "tool_result",
    ]) {
      expect(piProbe.events).toContain(requiredEvent);
      expect(ompProbe.events).toContain(requiredEvent);
    }
    expect(piProbe.beforeAgentStartInjectedSection).toBe(true);
  }, 30_000);

  test("validates real OMP getSelectListTheme().symbols against HostSymbolTheme and discriminates Pi 1.x Editor/Input/SettingsList capabilities", async () => {
    const [piProbe, ompProbe] = await loadHostProbes();

    expect(piProbe.editorHasSetTheme).toBe(false);
    expect(piProbe.selectListHasSymbols).toBe(false);
    expect(piProbe.settingsListHasPublicContract).toBe(false);
    expect(piProbe.inputHasGetCursor).toBe(false);

    expect(ompProbe.editorHasSetTheme).toBe(true);
    const symbols: unknown = ompProbe.selectListSymbols;
    expect(isHostSymbolTheme(symbols)).toBe(true);

    if (!isHostSymbolTheme(symbols)) {
      throw new Error("Expected OMP symbols to satisfy HostSymbolTheme");
    }
    expect(symbols.spinnerFrames.length).toBeGreaterThan(0);
    expect(symbols.boxRound.topLeft.length).toBeGreaterThan(0);
    expect(symbols.boxSharp.cross.length).toBeGreaterThan(0);
    expect(symbols.table.teeDown.length).toBeGreaterThan(0);

    expect(
      isHostSymbolTheme({
        ...symbols,
        boxSharp: {
          bottomLeft: "└",
          bottomRight: "┘",
          horizontal: "─",
          topLeft: "┌",
          topRight: "┐",
          vertical: "│",
        },
      })
    ).toBe(false);
    expect(
      isHostSymbolTheme({
        ...symbols,
        spinnerFrames: [],
      })
    ).toBe(false);

    expect(ompProbe.settingsListContract).toEqual({
      afterSelectId: "second",
      afterUpdateValue: "High",
      hasContract: true,
      hasOpenSubmenu: false,
      hasSearchQuery: false,
      initialSelectedId: "first",
    });
    expect(
      hasSettingsListPublicContract({
        getSelectedItem: () => undefined,
        hasOpenSubmenu: () => false,
        hasSearchQuery: () => false,
        openSubmenu: undefined,
        selectItem: () => true,
        updateValue: () => undefined,
      })
    ).toBe(true);
    expect(hasSettingsListPublicContract({})).toBe(false);

    expect(ompProbe.inputContract).toEqual({
      cursorAfterInsert: 2,
      hasGetCursor: true,
      initialCursor: 0,
    });
  });

  test("discriminates real OMP ExtensionContext agent identities from Pi 1.x contexts without global singletons", async () => {
    const [piProbe, ompProbe] = await loadHostProbes();

    expect(piProbe.contextHasOmpAgentIdentity).toBe(false);
    expect(
      hasOmpAgentIdentity({
        cwd: "/tmp",
        hasUI: false,
        isProjectTrusted: () => false,
      })
    ).toBe(false);
    expect(hasOmpAgentIdentity({ agent: { id: "", kind: "main" } })).toBe(
      false
    );
    expect(hasOmpAgentIdentity({ agent: { id: "main", kind: "other" } })).toBe(
      false
    );

    expect(hasOmpAgentIdentity(ompProbe.contexts.main)).toBe(true);
    expect(hasOmpAgentIdentity(ompProbe.contexts.sub)).toBe(true);
    expect(hasOmpAgentIdentity(ompProbe.contexts.nativeAdvisor)).toBe(true);

    if (
      !hasOmpAgentIdentity(ompProbe.contexts.main) ||
      !hasOmpAgentIdentity(ompProbe.contexts.sub) ||
      !hasOmpAgentIdentity(ompProbe.contexts.nativeAdvisor)
    ) {
      throw new Error("Expected real OMP contexts to carry HostAgentIdentity");
    }
    expect(ompProbe.contexts.main.agent).toMatchObject({
      id: "Main",
      kind: "main",
    });
    expect(ompProbe.contexts.sub.agent).toMatchObject({
      id: "Task1",
      kind: "sub",
    });
    expect(ompProbe.contexts.nativeAdvisor.agent).toMatchObject({
      id: "advisor",
      kind: "sub",
    });
  });

  test("bounded fixture helpers chain multi-event handlers sequentially, await async setActiveTools, and dispatch host settlement events", async () => {
    const activeTools = ["ask_advisor"];
    const events = new Map<string, DualHostEventHandler>();
    const settledOrder: string[] = [];
    const pi = mockPi({
      activeTools,
      deferSetActiveTools: true,
      events,
    });

    // SAFETY: test registers dual-host lifecycle handlers against the shared mock ExtensionAPI event hook.
    const registerHook = pi.on.bind(pi) as (
      event: string,
      handler: DualHostEventHandler
    ) => void;
    registerHook("before_agent_start", async (event) => {
      await Promise.resolve();
      const base =
        "systemPrompt" in event && Array.isArray(event.systemPrompt)
          ? event.systemPrompt
          : [];
      return { systemPrompt: [...base, "block-1"] };
    });
    registerHook("before_agent_start", (event) => {
      const base =
        "systemPrompt" in event && Array.isArray(event.systemPrompt)
          ? event.systemPrompt
          : [];
      return { systemPrompt: [...base, "block-2"] };
    });
    registerHook("agent_settled", () => {
      settledOrder.push("pi:first");
    });
    registerHook("agent_settled", () => {
      settledOrder.push("pi:second");
    });
    registerHook("agent_end", (event) => {
      const willContinue =
        "willContinue" in event && event.willContinue === true;
      settledOrder.push(willContinue ? "omp:continue" : "omp:final");
    });

    const pendingMutation = pi.setActiveTools([]);
    expect(pi.getActiveTools()).toEqual(["ask_advisor"]);
    await pendingMutation;
    expect(pi.getActiveTools()).toEqual([]);

    const dispatched = await dispatchBeforeAgentStart(
      events,
      { prompt: "hello", systemPrompt: ["base"] },
      {}
    );
    expect(dispatched.systemPrompt).toEqual(["base", "block-1", "block-2"]);

    await dispatchHostSettlement(events, "pi", {});
    await dispatchHostSettlement(events, "omp", {}, { willContinue: true });
    await dispatchHostSettlement(events, "omp", {}, { willContinue: false });
    expect(settledOrder).toEqual([
      "pi:first",
      "pi:second",
      "omp:continue",
      "omp:final",
    ]);
  });

  test("links package into isolated OMP environment and resolves built bundle dist/index.js in fresh process (Phase 06 / R2)", async () => {
    if (!hasOmpExecutable()) {
      return;
    }
    const result = await runIsolatedOmpPluginLink();
    expect(result.listExtensions).toEqual(["./dist/index.js"]);
    expect(result.realPath).toBe(BUNDLED_ENTRY);
  }, 30_000);
});
