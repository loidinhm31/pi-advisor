# Prompt Injection, Settings & Lifecycle Rescan Report

## 1. Current Implementation Rescan & Exact Evidence

### A. `before_agent_start`: `string[]` Replacement vs `sections`

- **Fork (`pi-advisor/src/tools/register-lifecycle.ts:62-84`)**: Reads `event.systemPromptOptions?.sections`; returns early at L64-66 when absent. Deletes `sections.advisor_invocation_settings`, checks `pi.getActiveTools().includes("ask_advisor")`, calls `loadConfig(ctx)`, checks `advisorModelAccess(ctx).allowed && !sameModelAdvisorDisabled(ctx)`, builds `advisorInvocationGuidelines()` + optional budget line, and writes `sections.advisor_invocation_settings`.
- **OMP (`oh-my-pi/packages/coding-agent/src/extensibility/extensions/types.ts:986-993,1435-1438`; `runner.ts:109-113,2121-2173`; `session/agent-session.ts:7752-7825`; `session/session-tools.ts:525-546`)**:
  - `BeforeAgentStartEvent` is `{ type: "before_agent_start", prompt: string, images?: ImageContent[], systemPrompt: string[] }` (no `systemPromptOptions`).
  - `emitBeforeAgentStart` (`runner.ts:2152-2156`) chains handlers: when a handler returns `{ systemPrompt }`, `currentSystemPrompt` becomes `typeof result.systemPrompt === "string" ? [result.systemPrompt] : result.systemPrompt`.
  - `#prepareAgentStart` (`agent-session.ts:7752-7825`) retries up to `AGENT_START_POLICY_MAX_ATTEMPTS = 3` and applies `setTurnSystemPromptOverride(result.systemPrompt, basePreparation.systemPrompt)` for that turn (`clearTurnSystemPromptOverride()` at L8063). Returning `undefined` keeps `baseXdevCatalogDelivered: true` (L7809).

### B. `xd://` Transport, Startup Active Tools & `await setActiveTools`

- **Startup active tools & `xd://` mount (`oh-my-pi/packages/coding-agent/src/sdk.ts:4024-4036,4080-4099,4784-4829`; `extensibility/extensions/wrapper.ts:78`; `tools/xdev.ts:62-65,299-336`)**:
  - `register-ask-advisor.ts:138` and `register-outcome.ts:15` omit `defaultInactive` and `loadMode`, so OMP defaults them to `loadMode: "discoverable"`, enables both in `initialToolNames` at startup, and mounts them under `xd://` (`toolSession.xdev.mountedNames`) whenever `tools.xdev` is on and `read`+`write` are present.
  - `pi.getActiveTools()` in OMP (`modes/runtime-init.ts:125`, `session/session-tools.ts:624-631`) returns `session.getEnabledToolNames()`, which is `#enabledToolNames ∪ #xdev.mountedNames`. Thus `pi.getActiveTools().includes("ask_advisor")` is `true` when mounted under `xd://`.
  - OMP's base system prompt (`sdk.ts:3844-3960`, `xdev.ts:299-336`) advertises mounted tools as `- xd://ask_advisor — …` (catalog) or `Execute by writing JSON to xd://ask_advisor.` (inline).
- **Unawaited `setActiveTools` (`pi-advisor/src/commands/activation.ts:129`, `src/commands/settings-commands.ts:105`)**:
  - In OMP, `pi.setActiveTools(toolNames): Promise<void>` (`types.ts:1755`, `runner.ts:793-797`, `session-tools.ts:1913-1924`) is async (serialized via `runToolRegistryMutation` + prompt rebuild). Both `/advisor` (`activation.ts:129`) and `/advisor-off` (`settings-commands.ts:105`) call `setActiveTools` without `await`.
- **`tool_call` / `tool_result` under `write xd://<device>` (`agent-session.ts:4954-4966`; `runner.ts:589-630`; `wrapper.ts:237-285,456-475`; `internal-urls/xd-protocol.ts:97-114`; `tools/xdev.ts:396-447`)**:
  - Calling `write` with `path: "xd://ask_advisor"` fires:
    1. Outer `tool_call` (`toolName: "write"`, `toolCallId`, `input: { path: "xd://ask_advisor", content: "..." }`).
    2. Inner `tool_call` (`toolName: "ask_advisor"`, same `toolCallId`, `input: parsedArgs`) unless `content` is help (`""`/`"?"`/`"help"`).
    3. Inner `tool_result` (`toolName: "ask_advisor"`).
    4. Outer `tool_result` (`toolName: "write"`, `input: { path: "xd://ask_advisor", ... }`, `details: { xdev: { tool: "ask_advisor", ... } }`).
  - **3 `xd://` lifecycle/disclosure bugs found**:
    1. `register-lifecycle.ts:90-94`: Outer `tool_result` has `event.toolName === "write" !== "ask_advisor"`, so it immediately calls `session.advanceFollowUpToolCall()`, burning 1 of `FOLLOW_UP_MAX_TOOL_CALLS` (3) on the consultation call itself.
    2. `register-lifecycle.ts:121-131` & `loop-gate.ts:175-186`: Outer `tool_call` (`toolName: "write"`) bypasses `event.toolName === "ask_advisor"` and runs `handleAutomaticGate` -> `session.recordToolCall("write", event.input, threshold)`, resetting loop tracking on other tools or triggering false loop gates after repeated `write xd://ask_advisor` calls.
    3. `src/scout-groups.ts:68-109` (`pendingInvocationDisclosure`): Only strips `draft` when `part.name === "ask_advisor"`. For `write xd://ask_advisor`, `part.name === "write"`, leaking raw `draft` inside `arguments.content` into the `pending-invocation` Scout group.

### C. Config Layering, Explicit `false`, `simpleMode` & Gate Flags

- **Global-only (`src/config/storage.ts:156-191`)**: `loadConfig` reads only `join(getAgentDir(), "advisor.json")` (`~/.omp/agent/advisor.json` in OMP); repo-local config is ignored (`test/config-project.test.ts:43-122`). (`configPaths` at `storage.ts:21-25` is unused).
- **Defaults vs explicit `false` (`src/config/defaults.ts:62-95,127-160`; `src/config/state.ts:34-43`)**: `resetDefaults()` sets `advisorPlanGateRef = true`, `advisorFailureGateRef = true`, `advisorCompletionGateRef = true`, `advisorAutoLoopGateRef = true`, `simpleModeRef = false`. `applyConfig()` applies any defined boolean (`false` overrides `true`).
- **Settings UI (`src/ui/settings-items.ts:329-468`; `src/ui/settings-selector.ts:241-265`; `src/commands/settings-persistence.ts:61-94`)**:
  - When `settings.simpleMode === true` (`settings-items.ts:346-358`), `createSettingsItems` returns early with only 6 items (`context`, `simpleMode`, `alwaysOn`, `fallbackModel`, `modelWhitelist`, `disableSameModel`).
  - When `settings.simpleMode === false` (`settings-items.ts:394-468`), `planGate`, `failureGate`, `completionGate`, `customRule`, `blockOnBlocked`, `autoLoopGate`, `loopThreshold`, and `maxCallsPerSession` are all rendered, mutable, and persisted. Toggling `simpleMode` in `AdvisorSettingsSelector.change` (`settings-selector.ts:241-265`) immediately rebuilds the list (`createSettingsList("simpleMode")`) and saves.

### D. Session Events (`agent_settled` vs `agent_end`) & Child Isolation

- **`agent_settled` vs `agent_end` (`register-lifecycle.ts:134-146`; `oh-my-pi/packages/coding-agent/src/extensibility/extensions/types.ts:1520-1589`; `session/agent-session.ts:5037-5064,5135-5140`)**:
  - OMP never emits `agent_settled`; it emits `agent_end` once per settle via `#emitAgentEndNotification` with `{ type: "agent_end", messages, willContinue?: boolean }`. Thus reservation cleanup and `advisorSessionSummaryRef` never run in OMP.
- **Child isolation (`src/child-session.ts:5-15`; `commands/activation.ts:58,124,135`; `commands/lifecycle.ts:50`; `oh-my-pi/.../types.ts:472-492,657`)**:
  - `isMarkedSubagent()` checks only `process.env.PI_SUBAGENT_CHILD === "1"`. OMP subagents (`task`, eval `agent()`, `/tan`, and built-in `advisor` tool calls) run in-process with `ctx.agent.kind === "sub"` (`types.ts:472-492`) and `PI_SUBAGENT_CHILD` unset. Without checking `ctx.agent?.kind === "sub"`, `alwaysOn` at subagent `session_start` overwrites the subagent's model/thinking with `executorRef`, and `model_select` can overwrite `advisor.json`.

---

## 2. Recommendations

1. **Fork-Only Dual-Host Transport Prompt API (`src/tools/prompts.ts`, `src/tools/register-lifecycle.ts`)**:
   - Extend `advisorInvocationGuidelines(options?: { transport?: "direct" | "xd" }): string[]` (default `"direct"` to preserve public facade signature in `test/facade-exports.test.ts`).
   - When `transport === "xd"`, replace bare `ask_advisor` call phrasing with `write` to `xd://ask_advisor` (e.g., `write` with `path: "xd://ask_advisor"` and JSON `content`, `"{}"` by default or `{"draft":"..."}` for plan/completion reviews).
   - Detect `"xd"` transport in `before_agent_start` when `Array.isArray(event.systemPrompt)` (or `ctx.getSystemPrompt?.()`) contains `"xd://ask_advisor"` (or when `event.systemPromptOptions?.sections` is absent and `xd://` is present in prompt blocks).
2. **Preservation, Dedupe, Off & Access Guards (`src/tools/register-lifecycle.ts`)**:
   - Define `ADVISOR_SETTINGS_HEADER = "Advisor invocation settings:\n"`.
   - If `event.systemPromptOptions?.sections` exists (Pi host): keep existing in-place `sections.advisor_invocation_settings` logic (`transport: "direct"`).
   - Else if `Array.isArray(event.systemPrompt)` (OMP host): filter out any existing element starting with `ADVISOR_SETTINGS_HEADER` (`cleaned`). If `!pi.getActiveTools().includes("ask_advisor")`, `!advisorModelAccess(ctx).allowed`, `sameModelAdvisorDisabled(ctx)`, or `guidelines.length === 0`, return `cleaned.length !== event.systemPrompt.length ? { systemPrompt: cleaned } : undefined` (avoiding unnecessary override when already clean). Otherwise return `{ systemPrompt: [...cleaned, `${ADVISOR_SETTINGS_HEADER}${guidelines.map(r => `- ${r}`).join("\n")}`] }`.
3. **Reuse Existing Settings (No Duplicate Keys)**:
   - Reuse `simpleMode`, `advisorPlanGate`, `advisorFailureGate`, `advisorCompletionGate`, `advisorCustomInvocation`, `advisorAutoLoopGate`, `advisorLoopThreshold`, `advisorMaxCallsPerSession`. Document clearly that turning `Simple mode` to `Off` in `/advisor-settings` reveals the individual Plan/Failure/Completion/Loop gate toggles.
4. **Prompt-Based vs Deterministic Enforcement & Budget/Privacy**:
   - **Prompt-based**: `planGate`, `failureGate`, `completionGate`, `customRule` inject behavioral rules into the system prompt via `before_agent_start` (suppressed when `simpleMode: true`). They rely on Executor LLM judgment, not pre-plan/pre-completion tool blocks.
   - **Deterministic**: `autoLoopGate` (`loopThreshold` consecutive normalized tool signatures in `tool_call`), `maxCallsPerSession` (shared across `ask_advisor`, loop gate, `/advisor-manual`, Jev turn gate), `modelWhitelist`, and `disableSameModel` are enforced in `tool_call` and `execute`.
   - **Outer `write xd://` & Privacy Guards**:
     - Add helper matching `toolName === "write"` targeting `xd://ask_advisor` (or `details?.xdev?.tool === "ask_advisor"`):
       - In `tool_call`: check `modelAccessBlock("ask_advisor", ctx)` and return early before `handleAutomaticGate` so `write xd://ask_advisor` never mutates `#repetition` (inner `ask_advisor` `tool_call` handles reservation). Also ignore tool events where `ctx.agent?.id === "advisor"` (OMP built-in advisor sharing parent runner).
       - In `tool_result`: do not call `session.advanceFollowUpToolCall()` when the outer `write` result is for `xd://ask_advisor`.
       - In `src/scout-groups.ts:68-109` (`pendingInvocationDisclosure`): when `part.name === "write"` targets `xd://ask_advisor`, sanitize `part.arguments.content` JSON to retain only `gitContext` and `question`, preventing `draft` leakage into `<conversation>`.
5. **Lifecycle & Child Isolation Fixes**:
   - Register settlement handler on both `pi.on("agent_settled", ...)` and `pi.on("agent_end", (event, ctx) => ...)` (on `agent_end`, always clear `reservedCalls`/`clearCallReservations()`, and emit session summary only when `!event?.willContinue`).
   - `await runtime.pi.setActiveTools(...)` in `src/commands/activation.ts:129` and `src/commands/settings-commands.ts:105`.
   - Update `isMarkedSubagent(ctx?)` in `src/child-session.ts:5` to check `process.env.PI_SUBAGENT_CHILD === "1" || (ctx as { agent?: { kind?: string } } | undefined)?.agent?.kind === "sub"`, threading `ctx` from `activation.ts:58,124,135` and `commands/lifecycle.ts:50`.

---

## 3. Acceptance Matrix & Implementation Phases

| Scenario                           | Host / Config                                                                                         | Expected Observable Behavior                                                                                                                                                                             |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prompt injection (OMP `xd://`)     | OMP (`event.systemPrompt: string[]` containing `xd://ask_advisor`), `simpleMode: false`, gates `true` | Returns `{ systemPrompt }` preserving all base blocks + 1 trailing `Advisor invocation settings:` block instructing `write` to `xd://ask_advisor` with `draft` for Plan/Completion and failure rules.    |
| Prompt injection (Pi `sections`)   | Pi (`event.systemPromptOptions.sections`)                                                             | Mutates `sections.advisor_invocation_settings` with direct `ask_advisor` wording; returns `undefined`.                                                                                                   |
| Dedupe & off/access guards         | OMP retry or `/advisor-off` or non-whitelisted/same model                                             | Strips prior `Advisor invocation settings:` block; returns `undefined` if base had none; injects nothing when off/disallowed/same-model.                                                                 |
| Simple mode vs Gate toggles        | `/advisor-settings` toggles `Simple mode` `On` ↔ `Off`                                                | `On`: hides gate rows, injects single on-demand rule without budget line. `Off`: shows `Plan gate`, `Failure gate`, `Completion gate`, `Custom invocation`; respects explicit `false` in `advisor.json`. |
| `write xd://ask_advisor` lifecycle | Model calls `write` with `path: "xd://ask_advisor"`                                                   | Outer `write` does not increment loop-gate repetition or advance `followUpTo` `toolCallsSince`; `pendingInvocationDisclosure` strips `draft` from `content`.                                             |
| Turn settle & child isolation      | OMP `agent_end` (`willContinue: false/true`); subagent `ctx.agent.kind === "sub"`                     | Clears stale reservations on `agent_end`; notifies summary only when `!willContinue`; subagent keeps host model/thinking and never overwrites `advisor.json`.                                            |

### Suggested Phases

1. **Phase 1 (Prompts & `before_agent_start`)**: Add `{ transport?: "direct" | "xd" }` to `advisorInvocationGuidelines` in `src/tools/prompts.ts`; add dual-host `sections` + `string[]` injection/dedupe in `src/tools/register-lifecycle.ts`.
2. **Phase 2 (`xd://` Lifecycle, Settle & Privacy)**: Guard outer `write xd://ask_advisor` in `tool_call`/`tool_result` (`register-lifecycle.ts`) and `pendingInvocationDisclosure` (`src/scout-groups.ts`); wire `agent_end` alongside `agent_settled`; `await setActiveTools` (`activation.ts`, `settings-commands.ts`); extend `isMarkedSubagent(ctx)` (`child-session.ts`).
3. **Phase 3 (Tests & Docs)**: Add behavioral unit tests for OMP `string[]` prompt injection/dedupe, `xd://` wording, outer `write xd://ask_advisor` follow-up/loop/Scout guards, `agent_end` settlement, and `ctx.agent.kind === "sub"` isolation; update `docs/configuration.md`.

## 4. Unresolved Questions

- When `alwaysOn: false` in OMP, should `ask_advisor` remain enabled at startup (matching current Pi behavior where extension tools start active unless `/advisor-off` is run), or should `session_start` deactivate `ask_advisor` when `alwaysOn: false` and `advisorRef === ""`?
