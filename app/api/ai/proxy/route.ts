import type {
  AssistantMessageEvent,
  Context,
  Model,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { streamSimple } from "@earendil-works/pi-ai/compat";

import { resolveApiKey, AI_BASE_URL } from "lib/ai-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ProxyRequestBody {
  model?: unknown;
  context?: unknown;
  options?: unknown;
}

const FORWARDABLE_OPTION_KEYS = [
  "reasoning",
  "maxTokens",
  "thinkingBudgets",
  "samplingParams",
  "sessionId",
  "cacheRetention",
] as const;

function forwardableOptions(value: unknown): SimpleStreamOptions {
  const options: Record<string, unknown> = {};
  if (value != null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of FORWARDABLE_OPTION_KEYS) {
      if (record[key] !== undefined) options[key] = record[key];
    }
  }
  return options as SimpleStreamOptions;
}

export async function POST(request: Request): Promise<Response> {
  let body: ProxyRequestBody;
  try {
    body = await request.json() as ProxyRequestBody;
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (body.model == null || typeof body.model !== "object" || body.context == null) {
    return Response.json({ error: "Model and context are required." }, { status: 400 });
  }

  // The API key and endpoint never come from the client: pin both here so a
  // tampered browser cannot make the server forward requests elsewhere.
  const model = {
    ...(body.model as Model<"openai-completions">),
    baseUrl: AI_BASE_URL,
  };
  const context = body.context as Context;
  const options = forwardableOptions(body.options);

  const encoder = new TextEncoder();
  const eventStream = streamSimple(model, context, {
    ...options,
    apiKey: resolveApiKey(),
    signal: request.signal,
  });

  const bodyStream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of eventStream) {
          controller.enqueue(
            encoder.encode(`${JSON.stringify(event)}\n`),
          );
        }
      } catch (error) {
        if (!request.signal.aborted) {
          const failure: AssistantMessageEvent = {
            type: "error",
            reason: "error",
            error: {
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
              errorMessage:
                error instanceof Error ? error.message : String(error),
              timestamp: Date.now(),
            },
          };
          controller.enqueue(encoder.encode(`${JSON.stringify(failure)}\n`));
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(bodyStream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
