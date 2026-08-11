import OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";

export const MODEL_FUNCTION_CALLING = "deepseek-v4-flash-free";
export const MODEL_TEXT = "deepseek-v4-flash-free";

const BASE_URL = "https://opencode.ai/zen/v1";

// The OpenCode Zen gateway accepts `Authorization: Bearer public` as
// anonymous access for the free models. An optional OPENCODE_API_KEY can be
// used for higher rate limits.
const ANONYMOUS_API_KEY = "public";

export type AIChatCompletionParams = ChatCompletionCreateParamsNonStreaming & {
  thinking?: { type: "enabled" | "disabled" };
};

let client: OpenAI | null = null;

export function getAIClient(): OpenAI {
  if (client == null) {
    client = new OpenAI({
      apiKey: process.env.OPENCODE_API_KEY ?? ANONYMOUS_API_KEY,
      baseURL: BASE_URL,
    });
  }
  return client;
}

function getErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let i = 0; i < 5; i++) {
    if (current && typeof current === "object" && "code" in current) {
      const code = (current as { code?: unknown }).code;
      if (typeof code === "string") return code;
    }
    if (current && typeof current === "object" && "cause" in current) {
      current = (current as { cause: unknown }).cause;
    } else {
      break;
    }
  }
  return undefined;
}

function isTransientError(error: unknown): boolean {
  if (error instanceof OpenAI.APIError && error.status != null) {
    return false;
  }
  const code = getErrorCode(error);
  return (
    code === undefined ||
    ["ENOTFOUND", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENETUNREACH"].includes(code)
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1 && isTransientError(error)) {
        await sleep(500 * (attempt + 1));
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

export async function generateText(
  prompt: string,
  options?: { system?: string; json?: boolean },
): Promise<string> {
  const completion = await chatCompletion({
    model: MODEL_TEXT,
    messages: [
      ...(options?.system ? [{ role: "system" as const, content: options.system }] : []),
      { role: "user", content: prompt },
    ],
    ...(options?.json ? { response_format: { type: "json_object" } } : {}),
    thinking: { type: "disabled" },
  });

  const message = completion.choices[0]?.message;
  const reasoningContent = (
    message as typeof message & { reasoning_content?: string }
  ).reasoning_content;
  return message?.content ?? reasoningContent ?? "";
}

export function stripMarkdownFences(
  text: string,
  language = "(?:json|jsonc|javascript)?",
): string {
  return text
    .replace(new RegExp(`^\`\`\`${language}\\n?`, "i"), "")
    .replace(/\n?```$/i, "")
    .trim();
}
