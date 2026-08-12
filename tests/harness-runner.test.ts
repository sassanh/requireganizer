import assert from "node:assert/strict";
import { describe, it } from "node:test";

import OpenAI from "openai";

import {
  HarnessToolGenerator,
  executeStructuredHarnessTask,
} from "../app/ai-harness/runner";
import type { HarnessToolDefinition } from "../app/ai-harness/tools";
import { InvalidJsonError, isRecord } from "../app/lib/json";

const resultTool: HarnessToolDefinition = {
  name: "submit_example",
  description: "Submit an example.",
  parameters: {
    type: "object",
    properties: { value: { type: "string" } },
    required: ["value"],
    additionalProperties: false,
  },
};

function parseValue(value: unknown): string {
  if (!isRecord(value) || typeof value.value !== "string") {
    throw new InvalidJsonError("value must be text.");
  }
  return value.value;
}

function response(
  name: string,
  argumentsJson: string,
  rawResponse = "raw completion",
) {
  return {
    calls: [{ name, arguments: argumentsJson }],
    rawResponse,
    metadata: {
      responseId: `response-${rawResponse}`,
      model: "test-model",
      finishReason: "tool_calls",
      usage: {
        inputTokens: 100,
        cachedInputTokens: 60,
        outputTokens: 20,
        totalTokens: 120,
      },
    },
  };
}

const task = {
  operation: "generate example",
  systemPrompt: "Use one function.",
  userPrompt: "Generate an example.",
  resultTool,
  parseResult: parseValue,
  provider: "provider.test",
  providerModel: "test-model",
};

describe("structured harness runner", () => {
  it("accepts a valid task-specific function call", async () => {
    const result = await executeStructuredHarnessTask({
      ...task,
      generate: async () => response("submit_example", '{"value":"ok"}'),
    });

    assert.equal(result.status, "success");
    if (result.status !== "success") assert.fail("Expected success result.");
    assert.equal(result.value, "ok");
    assert.deepEqual(
      result.metadata.providerCalls.map(({ outcome, model, provider }) => ({
        outcome,
        model,
        provider,
      })),
      [{ outcome: "success", model: "test-model", provider: "provider.test" }],
    );
  });

  it("uses communicate for essential missing input", async () => {
    const result = await executeStructuredHarnessTask({
      ...task,
      generate: async () =>
        response("communicate", '{"message":"Which environment?"}'),
    });

    assert.equal(result.status, "needs_input");
    if (result.status !== "needs_input") {
      assert.fail("Expected needs-input result.");
    }
    assert.equal(result.message, "Which environment?");
    assert.equal(result.metadata.providerCalls[0]?.outcome, "needs_input");
  });

  it("repairs an invalid call through the same formal tools", async () => {
    const prompts: string[] = [];
    const toolNames: string[][] = [];
    const generate: HarnessToolGenerator = async (prompt, options) => {
      prompts.push(prompt);
      toolNames.push(options.tools.map(({ name }) => name));
      return prompts.length === 1
        ? response("submit_example", '{"value":42}', "first completion")
        : response("submit_example", '{"value":"repaired"}', "second completion");
    };

    const result = await executeStructuredHarnessTask({ ...task, generate });

    assert.equal(result.status, "success");
    if (result.status !== "success") assert.fail("Expected repaired result.");
    assert.equal(result.value, "repaired");
    assert.equal(prompts.length, 2);
    assert.match(prompts[1], /value must be text/);
    assert.deepEqual(toolNames, [
      ["submit_example", "communicate"],
      ["submit_example", "communicate"],
    ]);
    assert.deepEqual(
      result.metadata.providerCalls.map(({ attempt, outcome }) => ({
        attempt,
        outcome,
      })),
      [
        { attempt: 1, outcome: "rejected" },
        { attempt: 2, outcome: "success" },
      ],
    );
  });

  it("returns concise errors and development-only raw responses", async () => {
    const environment = process.env as Record<string, string | undefined>;
    const originalNodeEnvironment = environment.NODE_ENV;
    const originalConsoleError = console.error;
    const loggedErrors: string[] = [];
    environment.NODE_ENV = "development";
    console.error = (...values: unknown[]) => {
      loggedErrors.push(values.map(String).join(" "));
    };
    try {
      let attempt = 0;
      const result = await executeStructuredHarnessTask({
        ...task,
        generate: async () => {
          attempt += 1;
          return response(
            "submit_example",
            '{"value":42}',
            `raw completion ${attempt}`,
          );
        },
      });

      assert.equal(result.status, "error");
      if (result.status !== "error") assert.fail("Expected error result.");
      assert.equal(result.code, "invalid_tool_response");
      assert.match(result.message, /value must be text/);
      assert.doesNotMatch(result.message, /raw completion/);
      assert.match(result.details ?? "", /raw completion 1/);
      assert.match(result.details ?? "", /raw completion 2/);
      assert.match(loggedErrors.join("\n"), /raw completion 2/);
    } finally {
      console.error = originalConsoleError;
      if (originalNodeEnvironment === undefined) {
        delete environment.NODE_ENV;
      } else {
        environment.NODE_ENV = originalNodeEnvironment;
      }
    }
  });

  it("describes provider timeouts without pretending a response existed", async () => {
    const result = await executeStructuredHarnessTask({
      ...task,
      generate: async () => {
        throw new OpenAI.APIConnectionTimeoutError();
      },
    });

    assert.equal(result.status, "error");
    if (result.status !== "error") assert.fail("Expected error result.");
    assert.equal(result.code, "provider_request_failed");
    assert.match(result.message, /provider timed out/i);
    assert.match(result.message, /No model response was received/);
    assert.equal(result.metadata.providerCalls[0]?.outcome, "failed");
    assert.equal(result.metadata.providerCalls[0]?.toolCallCount, 0);
  });

  it("records provider failure identifiers for diagnosis", async () => {
    const providerError = Object.assign(new Error("rate limited"), {
      status: 429,
      code: "rate_limit_exceeded",
      requestID: "request-429",
    });
    const result = await executeStructuredHarnessTask({
      ...task,
      generate: async () => {
        throw providerError;
      },
    });

    assert.equal(result.status, "error");
    const metadata = result.metadata.providerCalls[0];
    assert.equal(metadata?.httpStatus, 429);
    assert.equal(metadata?.errorCode, "rate_limit_exceeded");
    assert.equal(metadata?.requestId, "request-429");
  });
});
