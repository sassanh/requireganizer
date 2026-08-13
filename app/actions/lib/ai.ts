import OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";

import type {
  ToolGenerationOptions,
  ToolModelResponse,
} from "ai-harness/runner";
import type { ProviderTokenUsage } from "lib/types";

const DEFAULT_MODEL = "deepseek-v4-flash-free";
const DEFAULT_BASE_URL = "https://opencode.ai/zen/v1";
const DEFAULT_TIMEOUT_MS = 60_000;
const ANONYMOUS_API_KEY = "public";

export const MODEL = process.env.AI_MODEL?.trim() || DEFAULT_MODEL;
export const BASE_URL = process.env.AI_BASE_URL?.trim() || DEFAULT_BASE_URL;
export const PROVIDER = (() => {
  try {
    return new URL(BASE_URL).host;
  } catch {
    return "custom";
  }
})();

function requestTimeout(): number {
  const configured = Number(process.env.AI_REQUEST_TIMEOUT_MS);
  return Number.isFinite(configured) && configured >= 1_000
    ? configured
    : DEFAULT_TIMEOUT_MS;
}

export function resolveApiKey(
  environment: Record<string, string | undefined> = process.env,
): string {
  return (
    environment.AI_API_KEY?.trim() ||
    environment.OPENCODE_API_KEY?.trim() ||
    ANONYMOUS_API_KEY
  );
}

export const AUTHENTICATION_MODE =
  resolveApiKey() === ANONYMOUS_API_KEY ? "anonymous" : "configured";

function isOpenCodeZen(baseURL: string): boolean {
  try {
    const url = new URL(baseURL);
    return (
      url.protocol === "https:" &&
      url.hostname === "opencode.ai" &&
      url.pathname.replace(/\/+$/, "") === "/zen/v1"
    );
  } catch {
    return false;
  }
}

type ThinkingControl = {
  thinking?: { type: "disabled" };
};

export type AIChatCompletionParams = ChatCompletionCreateParamsNonStreaming &
  ThinkingControl;

export interface ToolCompletionTarget {
  model: string;
  baseURL: string;
}

let client: OpenAI | null = null;

export function getAIClient(): OpenAI {
  if (client == null) {
    client = new OpenAI({
      apiKey: resolveApiKey(),
      baseURL: BASE_URL,
      maxRetries: 0,
      timeout: requestTimeout(),
    });
  }
  return client;
}

function getErrorIdentifier(error: unknown): string | undefined {
  const pending: unknown[] = [error];
  const visited = new Set<object>();
  for (let inspected = 0; pending.length > 0 && inspected < 10; inspected += 1) {
    const current = pending.shift();
    if (current == null || typeof current !== "object" || visited.has(current)) {
      continue;
    }
    visited.add(current);
    const record = current as Record<string, unknown>;
    for (const key of ["code", "type"] as const) {
      const identifier = record[key];
      if (
        typeof identifier === "string" &&
        identifier.length > 0 &&
        identifier !== "error"
      ) {
        return identifier;
      }
    }
    pending.push(record.cause, record.error);
  }
  return undefined;
}

export function isTransientError(error: unknown): boolean {
  if (error instanceof OpenAI.APIConnectionError) return true;
  if (error instanceof OpenAI.APIError && error.status != null) {
    return (
      [408, 409, 425, 429].includes(error.status) || error.status >= 500
    );
  }
  const code = getErrorIdentifier(error);
  return (
    code !== undefined &&
    ["ENOTFOUND", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENETUNREACH"].includes(code)
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function withRetry<T>(
  fn: () => Promise<T>,
  attempts = 3,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1 && isTransientError(error)) {
        await sleep(500 * 2 ** attempt);
      } else {
        throw error;
      }
    }
  }
  throw lastError;
}

export async function chatCompletion(
  params: AIChatCompletionParams,
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  return withRetry(() => getAIClient().chat.completions.create(params));
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function numberField(
  value: Record<string, unknown> | undefined,
  ...keys: string[]
): number | undefined {
  for (const key of keys) {
    const candidate = value?.[key];
    if (
      typeof candidate === "number" &&
      Number.isFinite(candidate) &&
      candidate >= 0
    ) {
      return candidate;
    }
  }
  return undefined;
}

function normalizeTokenUsage(value: unknown): ProviderTokenUsage | undefined {
  const usage = record(value);
  if (usage === undefined) return undefined;
  const promptDetails = record(usage.prompt_tokens_details);
  const inputDetails = record(usage.input_tokens_details);
  const inputTokens = numberField(usage, "prompt_tokens", "input_tokens");
  const outputTokens = numberField(
    usage,
    "completion_tokens",
    "output_tokens",
  );
  const normalized: ProviderTokenUsage = {
    inputTokens,
    cachedInputTokens:
      numberField(
        usage,
        "prompt_cache_hit_tokens",
        "cache_read_input_tokens",
        "cached_input_tokens",
      ) ??
      numberField(promptDetails, "cached_tokens") ??
      numberField(inputDetails, "cached_tokens"),
    cacheWriteTokens:
      numberField(usage, "cache_creation_input_tokens") ??
      numberField(promptDetails, "cache_write_tokens"),
    outputTokens,
    totalTokens:
      numberField(usage, "total_tokens") ??
      (inputTokens !== undefined && outputTokens !== undefined
        ? inputTokens + outputTokens
        : undefined),
  };

  return Object.values(normalized).some((count) => count !== undefined)
    ? normalized
    : undefined;
}

function requiresDisabledThinking({
  model,
  baseURL,
}: ToolCompletionTarget): boolean {
  if (model !== DEFAULT_MODEL) return false;

  return isOpenCodeZen(baseURL);
}

export function buildToolCompletionParams(
  prompt: string,
  { system, tools }: ToolGenerationOptions,
  target: ToolCompletionTarget = { model: MODEL, baseURL: BASE_URL },
): AIChatCompletionParams {
  return {
    model: target.model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
    tools: tools.map((tool) => ({
      type: "function" as const,
      function: tool,
    })),
    tool_choice: "required",
    parallel_tool_calls: false,
    ...(requiresDisabledThinking(target)
      ? { thinking: { type: "disabled" as const } }
      : {}),
  };
}

type CompletionGenerator = (
  params: AIChatCompletionParams,
) => Promise<OpenAI.Chat.Completions.ChatCompletion>;

export async function generateToolResponse(
  prompt: string,
  options: ToolGenerationOptions,
  complete: CompletionGenerator = chatCompletion,
): Promise<ToolModelResponse> {
  const completion = await complete(buildToolCompletionParams(prompt, options));

  const message = completion.choices[0]?.message;
  const calls = (message?.tool_calls ?? []).map((toolCall) =>
    toolCall.type === "function"
      ? {
        name: toolCall.function.name,
        arguments: toolCall.function.arguments,
      }
      : {
        name: `unsupported_${toolCall.type}`,
        arguments: "{}",
      },
  );
  const requestId = (
    completion as unknown as { _request_id?: unknown }
  )._request_id;

  return {
    calls,
    rawResponse: JSON.stringify(completion, null, 2),
    metadata: {
      responseId: completion.id,
      requestId: typeof requestId === "string" ? requestId : undefined,
      model: completion.model,
      finishReason: completion.choices[0]?.finish_reason ?? undefined,
      usage: normalizeTokenUsage(completion.usage),
    },
  };
}
