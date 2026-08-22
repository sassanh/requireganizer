import { Agent } from "@earendil-works/pi-agent-core";
import type { AgentEvent, AgentMessage, AgentTool } from "@earendil-works/pi-agent-core";
import type { Usage } from "@earendil-works/pi-ai";

import type { ProviderCallMetadata } from "lib/types";
import type { FlatStore } from "store/store";

import type { AiCommand } from "./command";
import { renderCommand } from "./command";
import { zenGatewayModel } from "./model";
import { proxyStreamFn } from "./proxy-stream";
import { buildReadTools } from "./read-tools";
import { buildResultTools } from "./result-tools";
import { buildAgentSystemPrompt } from "./system-prompt";

function overlayBridge(
  store: FlatStore,
  collected: { usage: Usage[]; turns: number },
  live: AgentMessage[],
): (event: AgentEvent) => void {
  let lastLiveFlush = 0;
  const flushLive = (force = false) => {
    const now = Date.now();
    if (!force && now - lastLiveFlush < 80) return;
    lastLiveFlush = now;
    store.setConversation([...live]);
  };

  return (event) => {
    switch (event.type) {
      case "turn_start":
        store.beginThinkingSegment();
        break;
      case "message_start":
        live.push(event.message as AgentMessage);
        flushLive(true);
        break;
      case "message_update": {
        const inner = event.assistantMessageEvent;
        if (inner.type === "thinking_delta") {
          store.appendThinking(inner.delta);
        } else if (inner.type === "text_delta") {
          store.appendThinking(inner.delta);
        }
        if (live.length > 0) live[live.length - 1] = event.message as AgentMessage;
        flushLive();
        break;
      }
      case "message_end":
        if (live.length > 0) live[live.length - 1] = event.message as AgentMessage;
        flushLive(true);
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
 * persisted on the store so the conversation survives reloads.
 */
export function getProjectAgent(store: FlatStore): Agent {
  return new Agent({
    initialState: {
      systemPrompt: buildAgentSystemPrompt(),
      model: zenGatewayModel,
      thinkingLevel: "high",
      tools: [],
      messages: (store.conversation ?? []) as AgentMessage[],
    },
    streamFn: proxyStreamFn(),
  });
}

/**
 * Run one user command through the conversation: refresh tools for the
 * command, prompt the agent, persist the transcript, and surface provider
 * metadata. Throws on provider failure so the caller's error handling applies.
 */
export async function runAgentCommand(
  store: FlatStore,
  operation: string,
  command: AiCommand,
): Promise<void> {
  const agent = getProjectAgent(store);
  store.setActiveAgent(agent);

  const collected = { usage: [], turns: 0 } as { usage: Usage[]; turns: number };
  const live: AgentMessage[] = [...(store.conversation ?? [])] as AgentMessage[];
  const unsubscribe = agent.subscribe(overlayBridge(store, collected, live));
  const startedAt = Date.now();
  try {
    const readTools: AgentTool[] = buildReadTools(store);
    agent.state.tools = [...readTools, ...buildResultTools(store, command)];
    await agent.prompt(renderCommand(command));

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
