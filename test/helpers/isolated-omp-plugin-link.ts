import { existsSync, realpathSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";

import { isRecord, isString } from "../../src/content-utils.ts";
import { createIsolatedEnv } from "./dual-host-harness.ts";

const PACKAGE_ROOT = resolvePath(import.meta.dirname, "../..");
const TIMEOUT_MS = 15_000;

export interface IsolatedOmpPluginLinkResult {
  linkExit: number;
  listExtensions: string[];
  realPath: string;
}

export const hasOmpExecutable = (): boolean => Boolean(Bun.which("omp"));

const runBoundedSubprocess = async (
  cmd: string[],
  cwd: string,
  env: Record<string, string>
): Promise<{ exitCode: number; stderr: string; stdout: string }> => {
  const proc = Bun.spawn(cmd, {
    cwd,
    env,
    stderr: "pipe",
    stdout: "pipe",
  });
  let timer: NodeJS.Timeout | undefined;
  try {
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        try {
          proc.kill();
        } catch {
          // Process already terminated.
        }
        reject(
          new Error(`Command timed out after ${TIMEOUT_MS}ms: ${cmd.join(" ")}`)
        );
      }, TIMEOUT_MS);
    });
    const resultPromise = Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    const [stdout, stderr, exitCode] = await Promise.race([
      resultPromise,
      timeoutPromise,
    ]);
    return { exitCode, stderr, stdout };
  } finally {
    clearTimeout(timer);
  }
};

export const runIsolatedOmpPluginLink =
  async (): Promise<IsolatedOmpPluginLinkResult> => {
    const bundledEntry = resolvePath(PACKAGE_ROOT, "dist/index.js");
    if (!existsSync(bundledEntry)) {
      throw new Error(`Missing built entry: ${bundledEntry}`);
    }
    const ompBin = Bun.which("omp");
    if (!ompBin) {
      throw new Error("Missing omp executable in PATH");
    }
    const isolated = createIsolatedEnv("omp-plugin-link-");
    try {
      const linkResult = await runBoundedSubprocess(
        [ompBin, "plugin", "link", PACKAGE_ROOT],
        isolated.cwd,
        isolated.env
      );
      if (linkResult.exitCode !== 0) {
        throw new Error(
          `omp plugin link failed with exit ${linkResult.exitCode}: ${linkResult.stderr || linkResult.stdout}`
        );
      }
      const listResult = await runBoundedSubprocess(
        [ompBin, "plugin", "list", "--json"],
        isolated.cwd,
        isolated.env
      );
      if (listResult.exitCode !== 0) {
        throw new Error(
          `omp plugin list failed with exit ${listResult.exitCode}: ${listResult.stderr || listResult.stdout}`
        );
      }
      const listJson: unknown = JSON.parse(listResult.stdout);
      let extensions: string[] = [];
      if (isRecord(listJson) && Array.isArray(listJson.npm)) {
        for (const item of listJson.npm) {
          if (
            isRecord(item) &&
            item.name === "pi-advisor-flow" &&
            isRecord(item.manifest) &&
            Array.isArray(item.manifest.extensions)
          ) {
            extensions = item.manifest.extensions.filter(
              (entry): entry is string => isString(entry)
            );
            break;
          }
        }
      }
      const targetPath = join(
        isolated.home,
        ".omp/plugins/node_modules/pi-advisor-flow/dist/index.js"
      );
      const realPath = existsSync(targetPath) ? realpathSync(targetPath) : "";
      return {
        linkExit: linkResult.exitCode,
        listExtensions: extensions,
        realPath,
      };
    } finally {
      isolated.cleanup();
    }
  };
