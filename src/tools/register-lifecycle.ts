import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
  advisorSessionSummaryRef,
  getAdvisorMaxCallsPerSession,
  isSimpleMode,
} from "../config/state.ts";
import { loadConfig } from "../config/storage.ts";
import { isRecordOf, isString } from "../content-utils.ts";
import { reserveAdvisorCall } from "./gate-policy.ts";
import { handleAutomaticGate } from "./loop-gate.ts";
import {
  advisorModelAccess,
  sameModelAdvisorDisabled,
} from "./model-access.ts";
import { advisorInvocationGuidelines } from "./prompts.ts";
import type {
  DualHostBeforeAgentStartEvent,
  ToolRegistrationContext,
} from "./types.ts";

const ADVISOR_PROMPT_BLOCK_START =
  "<!-- pi-advisor-flow:invocation-settings:start -->";
const ADVISOR_PROMPT_BLOCK_END =
  "<!-- pi-advisor-flow:invocation-settings:end -->";

interface DualHostPromptEventTarget {
  on: (
    event: "before_agent_start",
    handler: (
      event: DualHostBeforeAgentStartEvent | undefined,
      ctx: Parameters<typeof loadConfig>[0]
    ) => { systemPrompt: string[] } | undefined
  ) => void;
}

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
    session.resetTask();
    reservedCalls.clear();
    herdrBlock.clear();
    if (ctx?.hasUI) {
      ctx.ui.setStatus("advisor-usage", undefined);
    }
  });

  const buildActiveAdvisorBody = (
    ctx: Parameters<typeof loadConfig>[0]
  ): string | undefined => {
    if (!pi.getActiveTools().includes("ask_advisor")) {
      return undefined;
    }
    if (!loadConfigOrSkipGating(ctx)) {
      return undefined;
    }
    if (!advisorModelAccess(ctx).allowed || sameModelAdvisorDisabled(ctx)) {
      return undefined;
    }
    const guidelines = advisorInvocationGuidelines();
    const budget = isSimpleMode()
      ? undefined
      : session.remainingCalls(getAdvisorMaxCallsPerSession());
    if (budget !== undefined) {
      guidelines.push(
        `Advisor calls remaining this session: ${budget}.\nReserve calls for material decisions, repeated failures, or final review.`
      );
    }
    return guidelines.length > 0
      ? `Advisor invocation settings:\n${guidelines.map((rule) => `- ${rule}`).join("\n")}`
      : undefined;
  };

  // SAFETY: Both Pi 1.x and OMP dispatch before_agent_start through pi.on; OMP consumes returned string[] systemPrompt overrides.
  const dualHostPi = pi as DualHostPromptEventTarget & ExtensionAPI;
  dualHostPi.on(
    "before_agent_start",
    (
      event: DualHostBeforeAgentStartEvent | undefined,
      ctx: Parameters<typeof loadConfig>[0]
    ) => {
      const rawSections = event?.systemPromptOptions?.sections;
      if (isRecordOf(rawSections)) {
        delete rawSections.advisor_invocation_settings;
        const body = buildActiveAdvisorBody(ctx);
        if (body) {
          rawSections.advisor_invocation_settings = body;
        }
        return undefined;
      }
      if (Array.isArray(event?.systemPrompt)) {
        const cleaned = event.systemPrompt.filter(
          (block) => !isOwnedAdvisorBlock(block)
        );
        const hadOwnedBlock = cleaned.length !== event.systemPrompt.length;
        const body = buildActiveAdvisorBody(ctx);
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

  pi.on("tool_result", (event) => {
    if (event.toolName !== "ask_advisor") {
      session.advanceFollowUpToolCall();
    }
  });

  pi.on("tool_call", (event, ctx) => {
    if (session.blocked) {
      return {
        block: true,
        reason: session.blockedReason ?? "Advisor session is blocked.",
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
    if (sameModelAdvisorDisabled(ctx)) {
      return;
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

  pi.on("agent_settled", (_event, ctx) => {
    // Any reservation still present never reached execute (for example because
    // another handler blocked it or the turn was aborted).
    reservedCalls.clear();
    session.clearCallReservations();
    if (isSimpleMode() || session.blocked || !advisorSessionSummaryRef) {
      return;
    }
    const summary = session.summary(getAdvisorMaxCallsPerSession());
    if (summary && ctx.hasUI) {
      ctx.ui.notify(summary, "info");
    }
  });

  pi.on("session_shutdown", (_event, ctx) => {
    reservedCalls.clear();
    session.clearFollowUps();
    session.clearCallReservations();
    scoutStatus.clear(ctx);
    herdrBlock.clear();
    if (ctx?.hasUI) {
      ctx.ui.setStatus("advisor-usage", undefined);
    }
  });
};
