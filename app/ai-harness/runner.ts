import type {
  HarnessToolDefinition,
} from "ai-harness/tools";
import {
  COMMUNICATE_TOOL,
} from "ai-harness/tools";
import { InvalidJsonError, isRecord, parseJsonObject } from "lib/json";
import type {
  HarnessMetadata,
  HarnessResult,
} from "lib/types";
import {
  HARNESS_PROTOCOL_VERSION,
  PROMPT_VERSION,
} from "lib/types";

const MAX_PUBLIC_VALIDATION_CHARACTERS = 500;

export interface StructuredHarnessTask<Value> {
  operation: string;
  systemPrompt: string;
  userPrompt: string;
  resultTool: HarnessToolDefinition;
  parseResult: (value: unknown) => Value;
}

export interface ToolModelResponse {
  calls: Array<{ name: string; arguments: string }>;
  rawResponse: string;
}

export interface ToolGenerationOptions {
  system: string;
  tools: HarnessToolDefinition[];
}

export type HarnessToolGenerator = (
  prompt: string,
  options: ToolGenerationOptions,
) => Promise<ToolModelResponse>;

function compactError(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : "The tool response failed validation for an unknown reason.";
  const compact = message.split(/\s+/).join(" ").trim();
  if (compact.length <= MAX_PUBLIC_VALIDATION_CHARACTERS) return compact;
  return `${compact.slice(0, MAX_PUBLIC_VALIDATION_CHARACTERS - 1)}…`;
}

function errorDetails(error: unknown): string {
  return error instanceof Error
    ? error.stack ?? `${error.name}: ${error.message}`
    : String(error);
}

function developmentDetails(details: string): string | undefined {
  return process.env.NODE_ENV === "development" ? details : undefined;
}

function isTimeoutFailure(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (current instanceof Error && /timed?\s*out|timeout/i.test(current.message)) {
      return true;
    }
    if (isRecord(current) && current.code === "ETIMEDOUT") return true;
    if (!isRecord(current) || !("cause" in current)) return false;
    current = current.cause;
  }
  return false;
}

function parseCommunication(value: unknown): string {
  if (!isRecord(value)) {
    throw new InvalidJsonError("communicate arguments must be an object.");
  }
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== "message") {
    throw new InvalidJsonError(
      "communicate arguments must contain only message.",
    );
  }
  if (typeof value.message !== "string" || value.message.trim().length === 0) {
    throw new InvalidJsonError("communicate.message must be non-empty text.");
  }
  return value.message.trim();
}

function parseToolResponse<Value>(
  response: ToolModelResponse,
  resultTool: HarnessToolDefinition,
  parseResult: (value: unknown) => Value,
): { status: "success"; value: Value } | { status: "needs_input"; message: string } {
  if (response.calls.length !== 1) {
    throw new InvalidJsonError(
      response.calls.length === 0
        ? "The model did not call a required function tool."
        : `The model called ${response.calls.length} tools; exactly one is required.`,
    );
  }

  const call = response.calls[0];
  if (
    call.name !== COMMUNICATE_TOOL.name &&
    call.name !== resultTool.name
  ) {
    throw new InvalidJsonError(
      `The model called unsupported tool ${JSON.stringify(call.name)}; expected ${JSON.stringify(resultTool.name)} or ${JSON.stringify(COMMUNICATE_TOOL.name)}.`,
    );
  }
  const parameters = parseJsonObject(
    call.arguments,
    `Arguments for ${call.name}`,
  );
  if (call.name === COMMUNICATE_TOOL.name) {
    return { status: "needs_input", message: parseCommunication(parameters) };
  }
  return { status: "success", value: parseResult(parameters) };
}

function providerFailureMessage(operation: string, error: unknown): string {
  if (isTimeoutFailure(error)) {
    return `The AI provider timed out while trying to ${operation}. No model response was received and no project changes were applied. Try again.`;
  }
  return `The AI provider request failed while trying to ${operation}. No model response was received and no project changes were applied. Try again.`;
}

function formatAttempt(
  attempt: number,
  validationError: string,
  response: ToolModelResponse,
): string {
  return [
    `Attempt ${attempt}`,
    `Validation error: ${validationError}`,
    "Raw provider response:",
    response.rawResponse,
  ].join("\n");
}

export async function executeStructuredHarnessTask<Value>({
  generate,
  operation,
  systemPrompt,
  userPrompt,
  resultTool,
  parseResult,
}: StructuredHarnessTask<Value> & {
  generate: HarnessToolGenerator;
}): Promise<HarnessResult<Value>> {
  const metadata: HarnessMetadata = {
    operation,
    promptVersion: PROMPT_VERSION,
    protocolVersion: HARNESS_PROTOCOL_VERSION,
  };
  const failedAttempts: string[] = [];
  let previousToolCalls: ToolModelResponse["calls"] = [];
  let validationError = "";

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const prompt =
      attempt === 1
        ? userPrompt
        : JSON.stringify(
          {
            task:
              "Correct the previous function call so it satisfies the original task and selected tool schema.",
            validationError,
            previousToolCalls,
            originalRequest: userPrompt,
            rules: [
              "Call exactly one supplied function tool.",
              "Do not answer with ordinary assistant text.",
              "Do not repeat a value that the validation error identified as invalid.",
            ],
          },
          null,
          2,
        );

    let response: ToolModelResponse;
    try {
      response = await generate(prompt, {
        system: systemPrompt,
        tools: [resultTool, COMMUNICATE_TOOL],
      });
    } catch (error) {
      const providerFailure = [
        `Operation: ${operation}`,
        "Provider request failed before a model response was received.",
        errorDetails(error),
      ].join("\n\n");
      const details = [...failedAttempts, providerFailure].join(
        `\n\n${"=".repeat(80)}\n\n`,
      );
      if (process.env.NODE_ENV === "development") {
        console.error(`[AI harness] ${operation} provider failure.\n${details}`);
      }
      return {
        status: "error",
        code: "provider_request_failed",
        message: providerFailureMessage(operation, error),
        details: developmentDetails(details),
        metadata,
      };
    }

    try {
      const parsed = parseToolResponse(response, resultTool, parseResult);
      return parsed.status === "success"
        ? { status: "success", value: parsed.value, metadata }
        : { status: "needs_input", message: parsed.message, metadata };
    } catch (error) {
      validationError = compactError(error);
      previousToolCalls = response.calls;
      failedAttempts.push(formatAttempt(attempt, errorDetails(error), response));
      if (attempt === 2) {
        const details = [
          `Operation: ${operation}`,
          ...failedAttempts,
        ].join(`\n\n${"=".repeat(80)}\n\n`);
        if (process.env.NODE_ENV === "development") {
          console.error(
            `[AI harness] ${operation} rejected the final tool response.\n${details}`,
          );
        }
        return {
          status: "error",
          code: "invalid_tool_response",
          message: `The AI returned an invalid function call while trying to ${operation}, and its automatic repair was also invalid. ${validationError} No project changes were applied. Try again.`,
          details: developmentDetails(details),
          metadata,
        };
      }
    }
  }

  return {
    status: "error",
    code: "invalid_tool_response",
    message: `The AI returned an invalid tool response while trying to ${operation}. No project changes were applied. Try again.`,
    details: developmentDetails(failedAttempts.join("\n\n")),
    metadata,
  };
}
