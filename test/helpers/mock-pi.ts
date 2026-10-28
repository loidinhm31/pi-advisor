import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { AgentAwareContext } from "../../src/child-session.ts";
import { isRecordOf, isString } from "../../src/content-utils.ts";
import type {
  DualHostBeforeAgentStartEvent,
  HostAgentEndEvent,
} from "../../src/tools/types.ts";

export type MockHandlerOutcome =
  | { block: boolean; reason?: string }
  | { systemPrompt?: string | string[] }
  | undefined;

export type MockEventPayload =
  | DualHostBeforeAgentStartEvent
  | HostAgentEndEvent
  | { reason?: string; type?: string };

type SyncVoidHandler = (...args: never[]) => void;
type AsyncVoidHandler = (...args: never[]) => Promise<void>;
type ValueHandler = (
  ...args: never[]
) => MockHandlerOutcome | Promise<MockHandlerOutcome>;

export type MockEventHandler =
  AsyncVoidHandler | SyncVoidHandler | ValueHandler;

export interface MockPiCapture {
  /** Tool names returned by getActiveTools; mutable when passed in. */
  activeTools?: string[];
  /** Registered command configs by name. */
  commands?: Map<string, any>;
  /** When true, setActiveTools mutates activeTools after a microtask tick to detect missing awaits. */
  deferSetActiveTools?: boolean;
  /** Captured transcript entries, in append order. */
  entries?: { data: unknown; type: string }[];
  /** Registered entry renderers by entry type. */
  entryRenderers?: Map<string, any>;
  /** All registered event handlers by event name, in registration order. */
  eventHandlers?: Map<string, MockEventHandler[]>;
  /** Registered event handlers by event name. */
  events?: Map<string, any>;
  /** Registered message renderers by custom message type. */
  messageRenderers?: Map<string, any>;
  /** Captured executor-bound messages with their send options. */
  sent?: { message: any; options: any }[];
  /** Registered tools by tool name. */
  tools?: Map<string, any>;
}

type InvocableHandler = (
  event?: MockEventPayload,
  ctx?: AgentAwareContext
) => MockHandlerOutcome | Promise<MockHandlerOutcome>;

const normalizePromptOverride = <TResult>(
  result: TResult
): string[] | undefined => {
  if (!isRecordOf(result) || !("systemPrompt" in result)) {
    return undefined;
  }
  const { systemPrompt } = result;
  if (isString(systemPrompt)) {
    return [systemPrompt];
  }
  if (
    Array.isArray(systemPrompt) &&
    systemPrompt.every((item) => isString(item))
  ) {
    return [...systemPrompt];
  }
  return undefined;
};

const chainEventPayload = <TResult>(
  eventName: string,
  currentEvent: MockEventPayload | undefined,
  result: TResult
): MockEventPayload | undefined => {
  if (eventName !== "before_agent_start" || !isRecordOf(currentEvent)) {
    return currentEvent;
  }
  const nextPrompt = normalizePromptOverride(result);
  if (nextPrompt === undefined) {
    return currentEvent;
  }
  return { ...currentEvent, systemPrompt: nextPrompt };
};

const runChainedHandlers = (
  eventName: string,
  list: readonly InvocableHandler[],
  initialEvent?: MockEventPayload,
  ctx?: AgentAwareContext
): MockHandlerOutcome | Promise<MockHandlerOutcome> => {
  let currentEvent = initialEvent;
  let latestDefined: MockHandlerOutcome;

  const continueAsync = async (
    startIndex: number,
    pendingFirst: Promise<MockHandlerOutcome>
  ): Promise<MockHandlerOutcome> => {
    const firstResolved = await pendingFirst;
    if (firstResolved !== undefined) {
      latestDefined = firstResolved;
    }
    currentEvent = chainEventPayload(eventName, currentEvent, firstResolved);
    for (let index = startIndex; index < list.length; index += 1) {
      const stepResult = await list[index]?.(currentEvent, ctx);
      if (stepResult !== undefined) {
        latestDefined = stepResult;
      }
      currentEvent = chainEventPayload(eventName, currentEvent, stepResult);
    }
    return latestDefined;
  };

  for (let index = 0; index < list.length; index += 1) {
    const stepResult = list[index]?.(currentEvent, ctx);
    if (stepResult instanceof Promise) {
      return continueAsync(index + 1, stepResult);
    }
    if (stepResult !== undefined) {
      latestDefined = stepResult;
    }
    currentEvent = chainEventPayload(eventName, currentEvent, stepResult);
  }
  return latestDefined;
};

const mutateToolsAsync = async (
  target: string[],
  next: string[]
): Promise<void> => {
  await Promise.resolve();
  target.splice(0, target.length, ...next);
};

const asVoidPromise = (promise: Promise<void>): void =>
  // SAFETY: Pi 1.x types setActiveTools as void while OMP returns Promise<void>; returning the Promise at runtime lets callers await async mutations.
  promise as never;

/**
 * Builds an ExtensionAPI stand-in for registration tests. Each collector
 * passed in activates the matching surface; unpassed surfaces are inert
 * no-ops. Members of `overrides` replace the defaults wholesale.
 */
export const mockPi = <TOverrides extends object>(
  capture: MockPiCapture = {},
  overrides?: TOverrides
): ExtensionAPI => {
  const { activeTools, deferSetActiveTools, ...collectors } = capture;
  const tools = activeTools ?? [];
  const handlersByEvent = new Map<string, InvocableHandler[]>();
  const api = {
    appendEntry<T>(type: string, data: T) {
      collectors.entries?.push({ data, type });
    },
    getActiveTools: () => [...tools],
    on(event: string, handler: MockEventHandler) {
      // SAFETY: ExtensionAPI event handlers accept (event, ctx) pairs and return MockHandlerOutcome.
      const invocable = handler as InvocableHandler;
      const list = handlersByEvent.get(event) ?? [];
      list.push(invocable);
      handlersByEvent.set(event, list);
      collectors.eventHandlers?.set(event, [...list]);
      if (list.length === 1) {
        collectors.events?.set(event, handler);
        return;
      }
      const snapshot = [...list];
      collectors.events?.set(
        event,
        (eventPayload?: MockEventPayload, ctx?: AgentAwareContext) =>
          runChainedHandlers(event, snapshot, eventPayload, ctx)
      );
    },
    registerCommand(name: string, config: any) {
      collectors.commands?.set(name, config);
    },
    registerEntryRenderer<T>(name: string, renderer: T) {
      collectors.entryRenderers?.set(name, renderer);
    },
    registerMessageRenderer<T>(type: string, renderer: T) {
      collectors.messageRenderers?.set(type, renderer);
    },
    registerTool(tool: { name: string }) {
      collectors.tools?.set(tool.name, tool);
    },
    sendMessage<T>(message: T, options: any) {
      collectors.sent?.push({ message, options });
    },
    setActiveTools(next: string[]) {
      if (deferSetActiveTools) {
        return asVoidPromise(mutateToolsAsync(tools, next));
      }
      tools.splice(0, tools.length, ...next);
      return asVoidPromise(Promise.resolve());
    },
    ...overrides,
  };

  // SAFETY: mock implements the ExtensionAPI registration surface tests consume; overrides replace members.
  return api as ExtensionAPI;
};
