import {
  isBoolean,
  isNumber,
  isRecord,
  isString,
} from "../../src/content-utils.ts";
import type { JsonValue } from "../../src/content-utils.ts";

export interface PiHostProbeResult {
  beforeAgentStartInjectedSection: boolean;
  commands: string[];
  contextHasOmpAgentIdentity: boolean;
  editorHasSetTheme: boolean;
  events: string[];
  host: "pi";
  inputHasGetCursor: boolean;
  isolatedAgentDir: string;
  isolatedHome: string;
  isolatedHomeVerified: boolean;
  resolvedPath: string;
  selectListHasSymbols: boolean;
  settingsListHasPublicContract: boolean;
  tools: string[];
}

export interface OmpHostProbeResult {
  commands: string[];
  contexts: {
    main: JsonValue;
    nativeAdvisor: JsonValue;
    sub: JsonValue;
  };
  editorHasSetTheme: boolean;
  events: string[];
  host: "omp";
  inputContract: {
    cursorAfterInsert: number;
    hasGetCursor: boolean;
    initialCursor: number;
  };
  isolatedAgentDir: string;
  isolatedHome: string;
  isolatedHomeVerified: boolean;
  resolvedPath: string;
  selectListSymbols: JsonValue;
  settingsListContract: {
    afterSelectId: string | null;
    afterUpdateValue: string | null;
    hasContract: boolean;
    hasOpenSubmenu: boolean;
    hasSearchQuery: boolean;
    initialSelectedId: string | null;
  };
  tools: string[];
}

const toStringArray = <Value>(value: Value): string[] | undefined =>
  Array.isArray(value) && value.every((item) => isString(item))
    ? value
    : undefined;

const toNullableString = <Value>(value: Value): string | null | undefined => {
  if (value === null) {
    return null;
  }
  if (isString(value)) {
    return value;
  }
  return undefined;
};

export const parsePiHostProbeResult = (raw: string): PiHostProbeResult => {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed) || parsed.host !== "pi") {
    throw new Error("Invalid Pi host probe payload.");
  }
  const commands = toStringArray(parsed.commands);
  const events = toStringArray(parsed.events);
  const tools = toStringArray(parsed.tools);
  if (
    !commands ||
    !events ||
    !tools ||
    !isBoolean(parsed.beforeAgentStartInjectedSection) ||
    !isBoolean(parsed.contextHasOmpAgentIdentity) ||
    !isBoolean(parsed.editorHasSetTheme) ||
    !isBoolean(parsed.inputHasGetCursor) ||
    !isString(parsed.isolatedAgentDir) ||
    !isString(parsed.isolatedHome) ||
    !isBoolean(parsed.isolatedHomeVerified) ||
    !isString(parsed.resolvedPath) ||
    !isBoolean(parsed.selectListHasSymbols) ||
    !isBoolean(parsed.settingsListHasPublicContract)
  ) {
    throw new Error("Incomplete Pi host probe payload fields.");
  }
  return {
    beforeAgentStartInjectedSection: parsed.beforeAgentStartInjectedSection,
    commands,
    contextHasOmpAgentIdentity: parsed.contextHasOmpAgentIdentity,
    editorHasSetTheme: parsed.editorHasSetTheme,
    events,
    host: "pi",
    inputHasGetCursor: parsed.inputHasGetCursor,
    isolatedAgentDir: parsed.isolatedAgentDir,
    isolatedHome: parsed.isolatedHome,
    isolatedHomeVerified: parsed.isolatedHomeVerified,
    resolvedPath: parsed.resolvedPath,
    selectListHasSymbols: parsed.selectListHasSymbols,
    settingsListHasPublicContract: parsed.settingsListHasPublicContract,
    tools,
  };
};

const parseOmpInputContract = <Value>(
  value: Value
): OmpHostProbeResult["inputContract"] => {
  if (
    !isRecord(value) ||
    !isNumber(value.cursorAfterInsert) ||
    !isBoolean(value.hasGetCursor) ||
    !isNumber(value.initialCursor)
  ) {
    throw new Error("Invalid OMP inputContract probe fields.");
  }
  return {
    cursorAfterInsert: value.cursorAfterInsert,
    hasGetCursor: value.hasGetCursor,
    initialCursor: value.initialCursor,
  };
};

const parseOmpSettingsListContract = <Value>(
  value: Value
): OmpHostProbeResult["settingsListContract"] => {
  if (
    !isRecord(value) ||
    !isBoolean(value.hasContract) ||
    !isBoolean(value.hasOpenSubmenu) ||
    !isBoolean(value.hasSearchQuery)
  ) {
    throw new Error("Invalid OMP settingsListContract boolean fields.");
  }
  const initialSelectedId = toNullableString(value.initialSelectedId);
  const afterSelectId = toNullableString(value.afterSelectId);
  const afterUpdateValue = toNullableString(value.afterUpdateValue);
  if (
    initialSelectedId === undefined ||
    afterSelectId === undefined ||
    afterUpdateValue === undefined
  ) {
    throw new Error("Invalid OMP settingsListContract selection fields.");
  }
  return {
    afterSelectId,
    afterUpdateValue,
    hasContract: value.hasContract,
    hasOpenSubmenu: value.hasOpenSubmenu,
    hasSearchQuery: value.hasSearchQuery,
    initialSelectedId,
  };
};

export const parseOmpHostProbeResult = (raw: string): OmpHostProbeResult => {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed) || parsed.host !== "omp") {
    throw new Error("Invalid OMP host probe payload.");
  }
  const commands = toStringArray(parsed.commands);
  const events = toStringArray(parsed.events);
  const tools = toStringArray(parsed.tools);
  const { contexts } = parsed;
  if (
    !commands ||
    !events ||
    !tools ||
    !isRecord(contexts) ||
    !isBoolean(parsed.editorHasSetTheme) ||
    !isString(parsed.isolatedAgentDir) ||
    !isString(parsed.isolatedHome) ||
    !isBoolean(parsed.isolatedHomeVerified) ||
    !isString(parsed.resolvedPath)
  ) {
    throw new Error("Incomplete OMP host probe payload fields.");
  }
  return {
    commands,
    contexts: {
      main: contexts.main ?? null,
      nativeAdvisor: contexts.nativeAdvisor ?? null,
      sub: contexts.sub ?? null,
    },
    editorHasSetTheme: parsed.editorHasSetTheme,
    events,
    host: "omp",
    inputContract: parseOmpInputContract(parsed.inputContract),
    isolatedAgentDir: parsed.isolatedAgentDir,
    isolatedHome: parsed.isolatedHome,
    isolatedHomeVerified: parsed.isolatedHomeVerified,
    resolvedPath: parsed.resolvedPath,
    selectListSymbols: parsed.selectListSymbols ?? null,
    settingsListContract: parseOmpSettingsListContract(
      parsed.settingsListContract
    ),
    tools,
  };
};

export const buildPiProbeScript = (packageRoot: string): string => `
  import { DefaultResourceLoader, getSelectListTheme, initTheme } from "./node_modules/@earendil-works/pi-coding-agent/dist/index.js";
  import { Editor, Input, SettingsList } from "./node_modules/@earendil-works/pi-tui/dist/index.js";

  const agentDir = process.env.PI_CODING_AGENT_DIR;
  const home = process.env.HOME;
  const cwd = ${JSON.stringify(packageRoot)};
  initTheme("dark");
  const loader = new DefaultResourceLoader({ agentDir, cwd });
  await loader.reload();
  const loaded = loader.getExtensions();
  if (loaded.errors.length > 0) {
    throw new Error(loaded.errors.map((e) => e.error).join("; "));
  }
  loaded.runtime.getActiveTools = () => ["ask_advisor"];
  const ext = loaded.extensions[0];
  const selectListTheme = getSelectListTheme();
  const list = new SettingsList(
    [{ id: "alpha", label: "Alpha", currentValue: "On", values: ["On", "Off"] }],
    10,
    {
      cursor: "-> ",
      description: (x) => x,
      hint: (x) => x,
      label: (x) => x,
      value: (x) => x,
    },
    () => undefined,
    () => undefined
  );
  const input = new Input({});
  const sections = {};
  const beforeHandlers = ext.handlers.get("before_agent_start") ?? [];
  for (const handler of beforeHandlers) {
    await handler(
      { prompt: "check", systemPrompt: "base", systemPromptOptions: { sections } },
      {
        cwd,
        hasUI: false,
        isProjectTrusted: () => false,
        model: { id: "executor", provider: "provider" },
      }
    );
  }
  console.log(JSON.stringify({
    beforeAgentStartInjectedSection: typeof sections.advisor_invocation_settings === "string" && sections.advisor_invocation_settings.length > 0,
    commands: [...ext.commands.keys()].toSorted(),
    contextHasOmpAgentIdentity: false,
    editorHasSetTheme: "setTheme" in Editor.prototype,
    events: [...ext.handlers.keys()].toSorted(),
    host: "pi",
    inputHasGetCursor: typeof input.getCursor === "function",
    isolatedAgentDir: agentDir,
    isolatedHome: home,
    isolatedHomeVerified:
      Boolean(home && agentDir && agentDir.startsWith(home)) &&
      process.env.PI_SUBAGENT_CHILD === undefined &&
      process.env.XDG_CONFIG_HOME === undefined &&
      process.env.XDG_DATA_HOME === undefined &&
      process.env.OMP_PROFILE === undefined &&
      process.env.PI_PROFILE === undefined,
    resolvedPath: ext.resolvedPath,
    selectListHasSymbols: Reflect.get(selectListTheme, "symbols") !== undefined,
    settingsListHasPublicContract:
      typeof list.getSelectedItem === "function" &&
      typeof list.hasOpenSubmenu === "function" &&
      typeof list.hasSearchQuery === "function" &&
      typeof list.selectItem === "function" &&
      typeof list.updateValue === "function",
    tools: [...ext.tools.keys()].toSorted(),
  }));
`;

export const buildOmpProbeScript = (bundledEntry: string): string => `
  import { loadExtensions } from "./packages/coding-agent/src/extensibility/extensions/loader.ts";
  import { ExtensionRunner, TOP_LEVEL_AGENT } from "./packages/coding-agent/src/extensibility/extensions/runner.ts";
  import { SessionManager } from "./packages/coding-agent/src/session/session-manager.ts";
  import { getSelectListTheme, getSettingsListTheme, initTheme } from "./packages/coding-agent/src/extensibility/legacy-pi-coding-agent-shim.ts";
  import { Editor, Input, SettingsList } from "./packages/coding-agent/src/extensibility/legacy-pi-tui-shim.ts";

  await initTheme("dark");
  const home = process.env.HOME;
  const agentDir = process.env.PI_CODING_AGENT_DIR;
  const loaded = await loadExtensions([${JSON.stringify(bundledEntry)}], process.cwd());
  if (loaded.errors.length > 0) {
    throw new Error(loaded.errors.map((e) => e.error).join("; "));
  }
  const ext = loaded.extensions[0];
  const sessionManager = SessionManager.inMemory(process.cwd());
  const mainRunner = new ExtensionRunner(
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
  const subRunner = new ExtensionRunner(
    loaded.extensions,
    loaded.runtime,
    process.cwd(),
    sessionManager,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { id: "Task1", kind: "sub", name: "worker" }
  );
  const mainCtx = mainRunner.createContext();
  const subCtx = subRunner.createContext();
  const nativeAdvisorCtx = mainRunner.createContext(undefined, undefined, {
    id: "advisor",
    kind: "sub",
  });

  const selectListTheme = getSelectListTheme();
  const settingsList = new SettingsList(
    [
      { id: "first", label: "First", currentValue: "On", values: ["On", "Off"] },
      { id: "second", label: "Second", currentValue: "Low", values: ["Low", "High"] },
    ],
    10,
    getSettingsListTheme(),
    () => undefined,
    () => undefined
  );
  const initialSelectedId = settingsList.getSelectedItem()?.id ?? null;
  settingsList.selectItem("second");
  const afterSelectId = settingsList.getSelectedItem()?.id ?? null;
  settingsList.updateValue("second", "High");
  const afterUpdateValue = settingsList.getSelectedItem()?.currentValue ?? null;

  const input = new Input();
  const initialCursor = typeof input.getCursor === "function" ? input.getCursor() : -1;
  input.handleInput("a");
  input.handleInput("b");
  const cursorAfterInsert = typeof input.getCursor === "function" ? input.getCursor() : -1;

  console.log(JSON.stringify({
    commands: [...ext.commands.keys()].toSorted(),
    contexts: {
      main: { agent: mainCtx.agent },
      nativeAdvisor: { agent: nativeAdvisorCtx.agent },
      sub: { agent: subCtx.agent },
    },
    editorHasSetTheme: "setTheme" in Editor.prototype,
    events: [...ext.handlers.keys()].toSorted(),
    host: "omp",
    inputContract: {
      cursorAfterInsert,
      hasGetCursor: typeof input.getCursor === "function",
      initialCursor,
    },
    isolatedAgentDir: agentDir,
    isolatedHome: home,
    isolatedHomeVerified:
      Boolean(home && agentDir && agentDir.startsWith(home)) &&
      process.env.PI_SUBAGENT_CHILD === undefined &&
      process.env.XDG_CONFIG_HOME === undefined &&
      process.env.XDG_DATA_HOME === undefined &&
      process.env.OMP_PROFILE === undefined &&
      process.env.PI_PROFILE === undefined,
    resolvedPath: ext.resolvedPath,
    selectListSymbols: Reflect.get(selectListTheme, "symbols"),
    settingsListContract: {
      afterSelectId,
      afterUpdateValue,
      hasContract:
        typeof settingsList.getSelectedItem === "function" &&
        typeof settingsList.hasOpenSubmenu === "function" &&
        typeof settingsList.hasSearchQuery === "function" &&
        typeof settingsList.selectItem === "function" &&
        typeof settingsList.updateValue === "function",
      hasOpenSubmenu: settingsList.hasOpenSubmenu(),
      hasSearchQuery: settingsList.hasSearchQuery(),
      initialSelectedId,
    },
    tools: [...ext.tools.keys()].toSorted(),
  }));
`;
