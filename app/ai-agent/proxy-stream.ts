import type { StreamFn } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type {
  AssistantMessage,
  AssistantMessageEvent,
  Model,
  SimpleStreamOptions,
 Context } from "@earendil-works/pi-ai";


function failureMessage(model: Model<"openai-completions">, message: string): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "error",
    errorMessage: message,
    timestamp: Date.now(),
  };
}

/**
 * A pi StreamFn that forwards the LLM request through the server-side
 * /api/ai/proxy route so the API key never reaches the browser. Events arrive
 * as newline-delimited JSON and are replayed into an AssistantMessageEventStream.
 */
export function proxyStreamFn(): StreamFn {
  return (model, context: Context, options?: SimpleStreamOptions) => {
    const eventStream = createAssistantMessageEventStream();
    void (async () => {
      try {
        const response = await fetch("/api/ai/proxy", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model, context, options }),
          signal: options?.signal,
        });
        if (!response.ok || response.body == null) {
          const detail = await response.text().catch(() => "");
          eventStream.push({
            type: "error",
            reason: "error",
            error: failureMessage(
              model as Model<"openai-completions">,
              `The AI proxy rejected the request (${response.status}).${detail ? ` ${detail}` : ""}`,
            ),
          });
          return;
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          for (;;) {
            const separator = buffer.indexOf("\n");
            if (separator < 0) break;
            const line = buffer.slice(0, separator);
            buffer = buffer.slice(separator + 1);
            if (line.trim().length === 0) continue;
            let event: AssistantMessageEvent;
            try {
              event = JSON.parse(line) as AssistantMessageEvent;
            } catch {
              throw new Error("Received a malformed AI proxy event.");
            }
            eventStream.push(event);
          }
        }
      } catch (error) {
        const aborted =
          error instanceof DOMException && error.name === "AbortError";
        eventStream.push({
          type: "error",
          reason: aborted ? "aborted" : "error",
          error: failureMessage(
            model as Model<"openai-completions">,
            aborted ? "Request aborted." : error instanceof Error ? error.message : String(error),
          ),
        });
      }
    })();
    return eventStream;
  };
}
