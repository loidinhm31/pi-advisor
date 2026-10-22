import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { hasOmpAgentIdentity, isNativeHostAdvisor } from "../child-session.ts";
import {
  advisorSessionSummaryRef,
  advisorToolsEnabledRef,
  getAdvisorMaxCallsPerSession,
  isSimpleMode,
} from "../config/state.ts";
import { loadConfig } from "../config/storage.ts";
import { advisorDeviceTarget, isRecordOf, isString } from "../content-utils.ts";
import { advisorBudgetMessage } from "./budget-feedback.ts";
import { reserveAdvisorCall } from "./gate-policy.ts";
import { handleAutomaticGate } from "./loop-gate.ts";
import {
  advisorModelAccess,
  sameModelAdvisorDisabled,
} from "./model-access.ts";
import { advisorInvocationGuidelines } from "./prompts.ts";
import type {
  DualHostBeforeAgentStartEvent,
  HostAgentEndEvent,
  ToolRegistrationContext,
} from "./types.ts";

const ADVISOR_PROMPT_BLOCK_START =
  "<!-- pi-advisor-flow:invocation-settings:start -->";
const ADVISOR_PROMPT_BLOCK_END =
  "<!-- pi-advisor-flow:invocation-settings:end -->";

interface DualHostPromptEventTarget {
  on: ((
    event: "before_agent_start",
    handler: (
      event: DualHostBeforeAgentStartEvent | undefined,
      ctx: Parameters<typeof loadConfig>[0]
    ) => { message?: unknown; systemPrompt?: string[] } | undefined
  ) => void) &
    ((
      event: "agent_end",
      handler: (
        event: HostAgentEndEvent | undefined,
        ctx: Parameters<typeof loadConfig>[0]
      ) => void
    ) => void);
}

type DualHostAPI = ExtensionAPI & DualHostPromptEventTarget;

const isOwnedAdvisorBlock = (block: unknown): block is string =>
  isString(block) &&
  block.startsWith(`${ADVISOR_PROMPT_BLOCK_START}\n`) &&
  block.endsWith(`\n${ADVISOR_PROMPT_BLOCK_END}`);

const hasUnrecognizedPromptContainer = (
  event: DualHostBeforeAgentStartEvent | undefined
): boolean => {
  const rawSections = event?.systemPromptOptions?.sections;
  return (
    (event?.systemPrompt !== undefined &&
      event?.systemPrompt !== null &&
      event?.systemPrompt !== "") ||
    (rawSections !== undefined && rawSections !== null)
  );
};
const modelAccessBlock = (
  toolName: string,
  ctx: Parameters<typeof loadConfig>[0]
): { block: true; reason: string } | undefined => {
  const access = advisorModelAccess(ctx);

  if (access.allowed || toolName !== "ask_advisor") {
    return undefined;
  }

  return {
    block: true,
    reason: access.reason,
  };
};

export const registerToolLifecycle = ({
  activeExecutions,
  herdrActivity,
  herdrBlock,
  pi,
  reservedCalls,
  runGate,
  scoutStatus,
  session,
}: ToolRegistrationContext): void => {
  // A throwing tool_call handler makes pi block that tool call (fail-safe); keep config errors local.
  let lastConfigErrorNotified: string | undefined;
  let cycleSettled = false;
  let unsupportedPromptEventNotified = false;
  const loadConfigOrSkipGating = (ctx: Parameters<typeof loadConfig>[0]) => {
    try {
      loadConfig(ctx);
      lastConfigErrorNotified = undefined;

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (message !== lastConfigErrorNotified) {
        lastConfigErrorNotified = message;

        if (ctx.hasUI) {
          ctx.ui.notify(
            `Advisor gating skipped; configuration is invalid. ${message} Fix advisor.json.`,
            "error"
          );
        }
      }

      return false;
    }
  };

  pi.on("session_start", (_event, ctx) => {
    cycleSettled = false;
    session.resetTask();
    reservedCalls.clear();
    activeExecutions?.clear();
    herdrBlock.clear();

    if (ctx?.hasUI) {
      ctx.ui.setStatus("advisor-usage", undefined);
    }
  });

  const buildActiveAdvisorBody = (
    ctx: Parameters<typeof loadConfig>[0],
    host: "pi" | "omp"
  ): string | undefined => {
    if (!pi.getActiveTools().includes("ask_advisor")) {
      return undefined;
    }
    if (!loadConfigOrSkipGating(ctx)) {
      return undefined;
    }
    loadConfig(ctx);

    if (
      !advisorToolsEnabledRef ||
      !advisorModelAccess(ctx).allowed ||
      sameModelAdvisorDisabled(ctx)
    ) {
      return undefined;
    }

    const guidelines = advisorInvocationGuidelines();

    if (host === "pi") {
      if (!isSimpleMode()) {
        guidelines.push(
          "Use the latest advisor-budget message for the current call allowance. Reserve calls for material decisions, repeated failures, or final review."
        );
      }
    } else {
      const budget = isSimpleMode()
        ? undefined
        : session.remainingCalls(getAdvisorMaxCallsPerSession());
      if (budget !== undefined) {
        guidelines.push(
          `Advisor calls remaining this session: ${budget}.\nReserve calls for material decisions, repeated failures, or final review.`
        );
      }
    }
    return guidelines.length > 0
      ? `Advisor invocation settings:\n${guidelines.map((rule) => `- ${rule}`).join("\n")}`
      : undefined;
  };

  // SAFETY: Both Pi 1.x and OMP dispatch before_agent_start through pi.on; OMP consumes returned string[] systemPrompt overrides.
  const dualHostPi = pi as DualHostAPI;
  dualHostPi.on(
    "before_agent_start",
    (
      event: DualHostBeforeAgentStartEvent | undefined,
      ctx: Parameters<typeof loadConfig>[0]
    ) => {
      cycleSettled = false;
      if (isNativeHostAdvisor(ctx)) {
        return undefined;
      }
      const rawSections = event?.systemPromptOptions?.sections;
      if (isRecordOf(rawSections)) {
        delete rawSections.advisor_invocation_settings;
        const body = buildActiveAdvisorBody(ctx, "pi");
        if (body) {
          rawSections.advisor_invocation_settings = body;
          return { message: advisorBudgetMessage(session) };
        }
        return undefined;
      }
      if (Array.isArray(event?.systemPrompt)) {
        const cleaned = event.systemPrompt.filter(
          (block) => !isOwnedAdvisorBlock(block)
        );
        const hadOwnedBlock = cleaned.length !== event.systemPrompt.length;
        const body = buildActiveAdvisorBody(ctx, "omp");
        if (!body) {
          return hadOwnedBlock ? { systemPrompt: cleaned } : undefined;
        }
        const ownedBlock = `${ADVISOR_PROMPT_BLOCK_START}\n${body}\n${ADVISOR_PROMPT_BLOCK_END}`;
        return { systemPrompt: [...cleaned, ownedBlock] };
      }
      if (
        hasUnrecognizedPromptContainer(event) &&
        !unsupportedPromptEventNotified
      ) {
        unsupportedPromptEventNotified = true;
        if (ctx?.hasUI) {
          ctx.ui.notify(
            "Advisor prompt injection skipped: host before_agent_start prompt container is unsupported.",
            "warning"
          );
        }
      }
      return undefined;
    }
  );

  pi.on("input", () => {
    session.clearFollowUps();
  });

  pi.on("tool_result", (event, ctx) => {
    if (isNativeHostAdvisor(ctx)) {
      return;
    }
    const input = "input" in event ? event.input : undefined;
    const isAdvisorDevice =
      event.toolName === "ask_advisor" ||
      advisorDeviceTarget(event.toolName, input, event.details) !== undefined;
    if (!isAdvisorDevice) {
      session.advanceFollowUpToolCall();
    }
  });

  pi.on("tool_call", (event, ctx) => {
    cycleSettled = false;
    if (isNativeHostAdvisor(ctx)) {
      return undefined;
    }
    if (session.blocked) {
      return {
        block: true,
        reason: session.blockedReason ?? "Advisor session is blocked.",
      };
    }

    const isAdvisorTool =
      event.toolName === "ask_advisor" ||
      event.toolName === "record_advisor_outcome";

    if (isAdvisorTool && !advisorToolsEnabledRef) {
      return {
        block: true,
        reason:
          "Advisor tools are disabled. Enable them in /advisor-settings or run /advisor.",
      };
    }

    if (!pi.getActiveTools().includes("ask_advisor")) {
      return;
    }

    if (!loadConfigOrSkipGating(ctx)) {
      // The ask_advisor execute path surfaces its own configuration errors as
      // tool errors; every other tool must proceed without Advisor gating.
      return;
    }

    if (isAdvisorTool && !advisorToolsEnabledRef) {
      return {
        block: true,
        reason:
          "Advisor tools are disabled. Enable them in /advisor-settings or run /advisor.",
      };
    }

    if (sameModelAdvisorDisabled(ctx)) {
      return;
    }
    if (advisorDeviceTarget(event.toolName, event.input)) {
      return undefined;
    }
    const accessBlock = modelAccessBlock(event.toolName, ctx);

    if (accessBlock) {
      return accessBlock;
    }

    const reservation = reserveAdvisorCall(event, ctx, session, reservedCalls);

    if (event.toolName === "ask_advisor") {
      return reservation;
    }

    return handleAutomaticGate(
      pi,
      event,
      ctx,
      session,
      runGate,
      scoutStatus,
      herdrActivity,
      herdrBlock
    );
  });

  const clearAbandonedReservations = () => {
    if (!activeExecutions || activeExecutions.size === 0) {
      reservedCalls.clear();
      session.clearCallReservations();
      return;
    }
    for (const id of reservedCalls) {
      if (!activeExecutions.has(id)) {
        reservedCalls.delete(id);
        session.releaseCall(id);
      }
    }
  };

  const handleFinalSettlement = (ctx: Parameters<typeof loadConfig>[0]) => {
    if (cycleSettled) {
      return;
    }
    cycleSettled = true;
    clearAbandonedReservations();
    if (isSimpleMode() || session.blocked || !advisorSessionSummaryRef) {
      return;
    }

    const summary = session.summary(getAdvisorMaxCallsPerSession());

    if (summary && ctx.hasUI) {
      ctx.ui.notify(summary, "info");
    }
  };

  dualHostPi.on("agent_end", (event, ctx) => {
    if (!hasOmpAgentIdentity(ctx) || isNativeHostAdvisor(ctx)) {
      return;
    }
    if (
      isRecordOf(event) &&
      "willContinue" in event &&
      event.willContinue === true
    ) {
      return;
    }
    handleFinalSettlement(ctx);
  });

  pi.on("agent_settled", (_event, ctx) => {
    if (hasOmpAgentIdentity(ctx)) {
      return;
    }
    handleFinalSettlement(ctx);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    cycleSettled = false;
    reservedCalls.clear();
    activeExecutions?.clear();
    session.clearFollowUps();
    session.clearCallReservations();
    scoutStatus.clear(ctx);
    herdrBlock.clear();

    if (ctx?.hasUI) {
      ctx.ui.setStatus("advisor-usage", undefined);
    }
  });
};
