import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";

import { isRecord, isRecordOf, isString } from "../../src/content-utils.ts";
import type {
  HostBoxSymbols,
  HostRoundedBoxSymbols,
  HostSymbolTheme,
  SettingsListPublicAdapterContract,
} from "../../src/ui/types.ts";
import {
  buildOmpProbeScript,
  buildPiProbeScript,
  parseOmpHostProbeResult,
  parsePiHostProbeResult,
} from "./dual-host-probes.ts";
import type {
  OmpHostProbeResult,
  PiHostProbeResult,
} from "./dual-host-probes.ts";

export type {
  OmpHostProbeResult,
  PiHostProbeResult,
} from "./dual-host-probes.ts";

const PACKAGE_ROOT = resolvePath(import.meta.dirname, "../..");
const OMP_ROOT = process.env.OMP_ROOT ?? "/home/loidinh/WS/oh-my-pi";

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

const CLEARED_ENV_KEYS = {
  OMP_PROFILE: true,
  PI_PROFILE: true,
  PI_SUBAGENT_CHILD: true,
  XDG_CACHE_HOME: true,
  XDG_CONFIG_HOME: true,
  XDG_DATA_HOME: true,
  XDG_STATE_HOME: true,
} satisfies Record<string, true>;

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

export const isHostSymbolTheme = (
  candidate: unknown
): candidate is HostSymbolTheme => {
  if (!isRecord(candidate)) {
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

export const hasSettingsListPublicContract = (
  candidate: unknown
): candidate is SettingsListPublicAdapterContract => {
  if (!isRecord(candidate)) {
    return false;
  }
  // SAFETY: isRecord narrows candidate to an object before checking public SettingsList method members.
  const methods = candidate as Partial<SettingsListPublicAdapterContract>;
  return (
    typeof methods.getSelectedItem === "function" &&
    typeof methods.hasOpenSubmenu === "function" &&
    typeof methods.hasSearchQuery === "function" &&
    typeof methods.selectItem === "function" &&
    typeof methods.updateValue === "function"
  );
};

const createIsolatedEnv = (prefix: string) => {
  const root = mkdtempSync(join(tmpdir(), prefix));
  chmodSync(root, 0o700);
  const home = join(root, "home");
  const agentDir = join(home, ".omp", "agent");
  const cwd = join(root, "cwd");
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  chmodSync(home, 0o700);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || key in CLEARED_ENV_KEYS) {
      continue;
    }
    env[key] = value;
  }
  env.HOME = home;
  env.PI_CODING_AGENT_DIR = agentDir;
  return {
    agentDir,
    cleanup: () => rmSync(root, { force: true, recursive: true }),
    cwd,
    env,
    home,
  };
};

const runSubprocessProbe = async <T>(
  prefix: string,
  spawnCwd: string,
  script: string,
  parse: (line: string) => T,
  setup?: (dirs: { agentDir: string; cwd: string; home: string }) => void
): Promise<T> => {
  const isolated = createIsolatedEnv(prefix);
  try {
    setup?.(isolated);
    const proc = Bun.spawn([process.execPath, "-e", script], {
      cwd: spawnCwd,
      env: isolated.env,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (exitCode !== 0) {
      throw new Error(
        `Subprocess probe (${prefix}) failed with exit ${exitCode}:\n${stderr || stdout}`
      );
    }
    const lastLine = stdout
      .trim()
      .split("\n")
      .findLast((line) => line.trim().startsWith("{"));
    if (!lastLine) {
      throw new Error(
        `Subprocess probe (${prefix}) emitted no JSON payload:\n${stdout}\n${stderr}`
      );
    }
    return parse(lastLine);
  } finally {
    isolated.cleanup();
  }
};

export const runPiHostProbe = (): Promise<PiHostProbeResult> => {
  const bundledEntry = resolvePath(PACKAGE_ROOT, "dist/index.js");
  if (!existsSync(bundledEntry)) {
    throw new Error(`Missing built entry: ${bundledEntry}`);
  }
  return runSubprocessProbe(
    "pi-host-probe-",
    PACKAGE_ROOT,
    buildPiProbeScript(PACKAGE_ROOT),
    parsePiHostProbeResult,
    ({ agentDir }) => {
      writeFileSync(
        join(agentDir, "settings.json"),
        JSON.stringify({ extensions: [PACKAGE_ROOT] })
      );
      writeFileSync(
        join(agentDir, "advisor.json"),
        JSON.stringify({
          advisor: "provider/advisor",
          executor: "provider/executor",
          simpleMode: false,
        })
      );
    }
  );
};

export const runOmpHostProbe = (): Promise<OmpHostProbeResult> => {
  const bundledEntry = resolvePath(PACKAGE_ROOT, "dist/index.js");
  if (!existsSync(bundledEntry)) {
    throw new Error(`Missing built entry: ${bundledEntry}`);
  }
  if (!existsSync(OMP_ROOT)) {
    throw new Error(
      `Missing OMP reference checkout at ${OMP_ROOT}; set OMP_ROOT to a valid oh-my-pi workspace.`
    );
  }
  return runSubprocessProbe(
    "omp-host-probe-",
    OMP_ROOT,
    buildOmpProbeScript(bundledEntry),
    parseOmpHostProbeResult,
    ({ agentDir }) => {
      writeFileSync(
        join(agentDir, "advisor.json"),
        JSON.stringify({
          advisor: "provider/advisor",
          executor: "provider/executor",
          simpleMode: false,
        })
      );
    }
  );
};

export const runOmpScript = <T>(
  prefix: string,
  script: string,
  parse: (line: string) => T,
  setup?: (dirs: { agentDir: string; cwd: string; home: string }) => void
): Promise<T> => {
  if (!existsSync(OMP_ROOT)) {
    throw new Error(
      `Missing OMP reference checkout at ${OMP_ROOT}; set OMP_ROOT to a valid oh-my-pi workspace.`
    );
  }
  return runSubprocessProbe(prefix, OMP_ROOT, script, parse, setup);
};
