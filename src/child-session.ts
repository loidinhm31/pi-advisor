import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { executorEffortRef, executorRef } from "./config/state.ts";
import { isRecord, isString } from "./content-utils.ts";

export interface HostAgentIdentity {
  depth?: number;
  id: string;
  kind: "main" | "sub";
  name?: string;
  parentId?: string;
}

export interface AgentAwareContext {
  agent?: HostAgentIdentity;
  model?: ExtensionContext["model"];
  thinkingLevel?: ExtensionContext["thinkingLevel"];
}

export const hasOmpAgentIdentity = (
  ctx?: unknown
): ctx is AgentAwareContext & { agent: HostAgentIdentity } => {
  if (!isRecord(ctx)) {
    return false;
  }
  const { agent } = ctx;
  if (!isRecord(agent)) {
    return false;
  }
  const { id, kind } = agent;
  return (kind === "main" || kind === "sub") && isString(id) && id.length > 0;
};

export const isMarkedSubagent = () => process.env.PI_SUBAGENT_CHILD === "1";

export const effectiveExecutorRef = (ctx: ExtensionContext) => {
  if (isMarkedSubagent() && ctx.model) {
    return `${ctx.model.provider}/${ctx.model.id}`;
  }
  return executorRef;
};

export const effectiveExecutorEffort = (ctx: ExtensionContext) =>
  isMarkedSubagent() ? ctx.thinkingLevel : executorEffortRef;
