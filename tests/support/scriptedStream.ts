import type { AgentOptions } from "@earendil-works/pi-agent-core";
import type {
  AssistantMessage,
  AssistantMessageEvent,
  ToolCall,
} from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";

/** A provider reply as the agent receives it. */
export function assistantMessage(content: AssistantMessage["content"]): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "openai-completions",
    provider: "opencode-zen",
    model: "x-preview-f-free",
    usage: {
      input: 10,
      output: 5,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 15,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: content.some((block) => block.type === "toolCall")
      ? "toolUse"
      : "stop",
    timestamp: Date.now(),
  };
}

/** A stream function that answers each call with the next scripted reply. */
export function scriptedStreamFn(responses: AssistantMessage[]) {
  let call = 0;
  const seenToolNames: string[][] = [];
  const streamFn: NonNullable<AgentOptions["streamFn"]> = (_model, context) => {
    seenToolNames.push((context.tools ?? []).map((tool) => tool.name));
    const stream = createAssistantMessageEventStream();
    const message = responses[Math.min(call, responses.length - 1)];
    call += 1;
    const events: AssistantMessageEvent[] = [
      { type: "start", partial: message },
      ...message.content.map((block, contentIndex) =>
        block.type === "text"
          ? ({ type: "text_delta", contentIndex, delta: block.text, partial: message } as AssistantMessageEvent)
          : ({ type: "toolcall_end", contentIndex, toolCall: block as ToolCall, partial: message } as AssistantMessageEvent),
      ),
      {
        type: "done",
        reason: message.stopReason as "stop" | "toolUse",
        message,
      },
    ];
    queueMicrotask(() => {
      for (const event of events) stream.push(event);
    });
    return stream;
  };
  return Object.assign(streamFn, { seenToolNames });
}
