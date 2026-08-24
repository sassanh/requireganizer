import { Agent } from "@earendil-works/pi-agent-core";
import type {
  AgentEvent,
  AgentMessage,
  AgentOptions,
  AgentTool,
} from "@earendil-works/pi-agent-core";
import type { Usage } from "@earendil-works/pi-ai";

import type { ProviderCallMetadata } from "lib/types";
import type { FlatStore } from "store/store";

import type { AiCommand } from "./command";
import { renderCommand } from "./command";
import { zenGatewayModel } from "./model";
import { proxyStreamFn } from "./proxy-stream";
import { buildReadTools } from "./read-tools";
import {
  buildAllStageResultTools,
  buildCommunicateTool,
  buildResultTools,
  buildStageActivationTool,
  consumePendingStageUnlock,
} from "./result-tools";
import { buildAgentSystemPrompt } from "./system-prompt";

// Stable per-project session id: pi-ai turns it into prompt-cache affinity
// (prompt_cache_key / session headers) where the provider supports it.
let agentSessionId: string | null = null;

export function setAgentSessionId(id: string | null): void {
  agentSessionId = id;
}

function overlayBridge(
  store: FlatStore,
  collected: { usage: Usage[]; turns: number },
  live: AgentMessage[],
): (event: AgentEvent) => void {
  // Streaming delivers one event per token delta. Writing every delta into
  // the store synchronously floods React with nested observer updates
  // ("Maximum update depth exceeded") and re-serializes the project for
  // autosave per token, so both stores share one throttled flush.
  let lastFlush = 0;
  let pendingThinking = "";

  const flush = (force = false) => {
    const now = Date.now();
    if (!force && now - lastFlush < 80) return;
    lastFlush = now;
    if (pendingThinking.length > 0) {
      store.appendThinking(pendingThinking);
      pendingThinking = "";
    }
    store.setConversation([...live]);
  };

  return (event) => {
    switch (event.type) {
      case "turn_start":
        store.beginThinkingSegment();
        break;
      case "message_start":
        live.push(event.message as AgentMessage);
        flush(true);
        break;
      case "message_update": {
        const inner = event.assistantMessageEvent;
        if (inner.type === "thinking_delta" || inner.type === "text_delta") {
          pendingThinking += inner.delta;
        }
        if (live.length > 0) live[live.length - 1] = event.message as AgentMessage;
        flush();
        break;
      }
      case "message_end":
        if (live.length > 0) live[live.length - 1] = event.message as AgentMessage;
        flush(true);
        break;
      case "tool_execution_start":
        store.appendThinking(`\n[tool: ${event.toolName}]\n`);
        break;
      case "turn_end": {
        collected.turns += 1;
        const message = event.message;
        if (message.role === "assistant") collected.usage.push(message.usage);
        break;
      }
      default:
        break;
    }
  };
}

function recordedMetadata(
  operation: string,
  startedAt: number,
  collected: { usage: Usage[]; turns: number },
  outcome: "success" | "failed",
): ProviderCallMetadata[] {
  if (collected.turns === 0) return [];
  const totals = collected.usage.reduce(
    (total, entry) => ({
      inputTokens: total.inputTokens + entry.input,
      cachedInputTokens: total.cachedInputTokens + entry.cacheRead,
      outputTokens: total.outputTokens + entry.output,
      totalTokens: total.totalTokens + entry.totalTokens,
    }),
    { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, totalTokens: 0 },
  );
  return [{
    operation,
    attempt: 1,
    promptVersion: "agent-conversation.1",
    protocolVersion: 6,
    startedAt: new Date(startedAt).toISOString(),
    durationMs: Date.now() - startedAt,
    provider: zenGatewayModel.provider,
    model: zenGatewayModel.id,
    outcome,
    toolCallCount: 0,
    finishReason: outcome === "success" ? "stop" : undefined,
    errorCode: outcome === "failed" ? "agent_run_failed" : undefined,
    usage: totals,
  }];
}

/**
 * Create (or reuse) the per-project conversation agent. The transcript is
 * persisted on the store so the conversation survives reloads. The stream
 * function defaults to the server proxy and can be replaced in tests.
 */
export function getProjectAgent(
  store: FlatStore,
  streamFn: AgentOptions["streamFn"] = proxyStreamFn(),
): Agent {
  return new Agent({
    initialState: {
      systemPrompt: buildAgentSystemPrompt(),
      model: zenGatewayModel,
      thinkingLevel: "high",
      tools: [],
      messages: (store.conversation ?? []) as AgentMessage[],
    },
    streamFn,
    ...(agentSessionId != null && { sessionId: agentSessionId }),
    // Mid-turn stage unlocks: when the model calls activate_stage_result_tool,
    // the unlocked submission tools are merged into the very next request of
    // the same turn.
    prepareNextTurnWithContext: (context) => {
      const unlocked = consumePendingStageUnlock();
      if (unlocked == null) return undefined;
      const current = context.context.tools ?? [];
      const merged = [
        ...current,
        ...unlocked.filter(
          (tool) => !current.some((existing) => existing.name === tool.name),
        ),
      ];
      return { context: { ...context.context, tools: merged } };
    },
  });
}

function userMessageText(message: AgentMessage): string | undefined {
  if (message.role !== "user") return undefined;
  // Some transcript entries in the message union carry no content at all.
  const block = (message as { content?: unknown }).content;
  if (!Array.isArray(block)) return undefined;
  const first = block[0];
  if (typeof first === "string") return first;
  if (first != null && typeof first === "object" && "text" in first) {
    return String((first as { text: unknown }).text);
  }
  return undefined;
}

/**
 * Re-issuing a stage command after a failed attempt replaces the dead
 * attempt instead of accumulating identical command copies. A duplicate is
 * recognized by the exact same command text whose turn ended in an error.
 */
function discardFailedDuplicateCommand(
  store: FlatStore,
  commandText: string,
): void {
  const messages = [...(store.conversation ?? [])] as AgentMessage[];
  let commandIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "user") continue;
    if (userMessageText(message) === commandText) commandIndex = index;
    break;
  }
  if (commandIndex < 0) return;
  const tail = messages.slice(commandIndex + 1);
  const onlyAttemptDebris = tail.every(
    (message) => message.role === "assistant" || message.role === "toolResult",
  );
  const last = tail[tail.length - 1];
  const endedInError = tail.length === 0 ||
    (last?.role === "assistant" && last.stopReason === "error");
  if (!onlyAttemptDebris || !endedInError) return;
  store.setConversation(messages.slice(0, commandIndex));
}

/**
 * The full conversation toolset: read tools, every stage submission channel
 * whose prerequisites currently hold, the stage activation escape hatch, and
 * the communicate channel. Composition is stable across turns (it only
 * changes when the workflow itself unlocks a stage), which keeps the
 * provider-side prompt cache warm.
 */
function buildConversationTools(store: FlatStore): AgentTool[] {
  return [
    ...buildReadTools(store),
    ...buildAllStageResultTools(store),
    buildStageActivationTool(store),
    buildCommunicateTool(),
  ];
}

/**
 * Run one user command through the conversation: refresh tools, prompt the
 * agent, persist the transcript, and surface provider metadata. Throws on
 * provider failure so the caller's error handling applies.
 */
export async function runAgentCommand(
  store: FlatStore,
  operation: string,
  command: AiCommand,
  streamFn?: AgentOptions["streamFn"],
): Promise<void> {
  discardFailedDuplicateCommand(store, renderCommand(command));
  // The full toolset is always present; the command contributes only its
  // own extras (revision targets, test-code channel), which construction
  // validates against the command.
  const allTools = buildConversationTools(store);
  const commandTools = buildResultTools(store, command);
  const extras = commandTools.filter(
    (tool) => !allTools.some((existing) => existing.name === tool.name),
  );
  await runAgentTurn(
    store,
    operation,
    renderCommand(command),
    [...allTools, ...extras],
    streamFn,
  );
}

/**
 * Run a free-form conversation turn (a plain user message, a regenerate, or
 * an edited message) with the full toolset.
 */
export async function runConversationTurn(
  store: FlatStore,
  operation: string,
  prompt: string | undefined,
  streamFn?: AgentOptions["streamFn"],
): Promise<void> {
  await runAgentTurn(store, operation, prompt, buildConversationTools(store), streamFn);
}

async function runAgentTurn(
  store: FlatStore,
  operation: string,
  prompt: string | undefined,
  tools: AgentTool[],
  streamFn?: AgentOptions["streamFn"],
): Promise<void> {
  const agent = getProjectAgent(store, streamFn);
  store.setActiveAgent(agent);

  const collected = { usage: [], turns: 0 } as { usage: Usage[]; turns: number };
  const live: AgentMessage[] = [...(store.conversation ?? [])] as AgentMessage[];
  const unsubscribe = agent.subscribe(overlayBridge(store, collected, live));
  const startedAt = Date.now();
  try {
    agent.state.tools = tools;
    // An undefined prompt resumes the existing transcript (regenerate/edit
    // flows); a string appends a new user message first.
    if (prompt == null) {
      await agent.continue();
    } else {
      await agent.prompt(prompt);
    }

    // Persist the authoritative transcript on every outcome (success, error,
    // and abort) so the sidebar reflects partial work as well.
    store.setConversation(agent.state.messages as unknown[]);

    const last = [...agent.state.messages].reverse()
      .find((message) => message.role === "assistant");
    if (last != null && last.role === "assistant") {
      if (last.stopReason === "aborted") return;
      if (last.stopReason === "error") {
        store.recordProviderCalls(recordedMetadata(
          operation,
          startedAt,
          collected,
          "failed",
        ));
        throw new Error(last.errorMessage ?? "The AI request failed.");
      }
    }
    store.recordProviderCalls(recordedMetadata(operation, startedAt, collected, "success"));
  } finally {
    unsubscribe();
    store.clearActiveAgent();
  }
}
