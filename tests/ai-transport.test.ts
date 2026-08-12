import assert from "node:assert/strict";
import { describe, it } from "node:test";

import OpenAI from "openai";

import {
  AIChatCompletionParams,
  buildToolCompletionParams,
  generateToolResponse,
  isTransientError,
} from "../app/actions/lib/ai";
import type { HarnessToolDefinition } from "../app/ai-harness/tools";

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

describe("OpenAI-compatible tool transport", () => {
  it("disables thinking for required tools on the default OpenCode model", () => {
    const params = buildToolCompletionParams("Generate it.", {
      system: "Use the supplied function.",
      tools: [resultTool],
    });

    assert.equal(params.tool_choice, "required");
    assert.equal(params.parallel_tool_calls, false);
    assert.equal("response_format" in params, false);
    assert.deepEqual(params.thinking, { type: "disabled" });
    assert.deepEqual(params.tools, [
      {
        type: "function",
        function: resultTool,
      },
    ]);
  });

  it("omits OpenCode thinking controls for other provider targets", () => {
    const params = buildToolCompletionParams(
      "Generate it.",
      { system: "Use the supplied function.", tools: [resultTool] },
      {
        model: "provider-model",
        baseURL: "https://provider.example/v1",
      },
    );

    assert.equal(params.model, "provider-model");
    assert.equal("thinking" in params, false);
    assert.equal(params.tool_choice, "required");
  });

  it("reads the result from message.tool_calls", async () => {
    let captured: AIChatCompletionParams | undefined;
    const completion = {
      id: "completion-1",
      object: "chat.completion",
      created: 0,
      model: "test-model",
      choices: [
        {
          index: 0,
          finish_reason: "tool_calls",
          logprobs: null,
          message: {
            role: "assistant",
            content: null,
            refusal: null,
            annotations: [],
            tool_calls: [
              {
                id: "call-1",
                type: "function",
                function: {
                  name: "submit_example",
                  arguments: '{"value":"accepted"}',
                },
              },
            ],
          },
        },
      ],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 20,
        total_tokens: 120,
        prompt_tokens_details: {
          cached_tokens: 75,
          audio_tokens: 0,
        },
        completion_tokens_details: {
          accepted_prediction_tokens: 0,
          audio_tokens: 0,
          reasoning_tokens: 0,
          rejected_prediction_tokens: 0,
        },
      },
    } as unknown as OpenAI.Chat.Completions.ChatCompletion;

    const response = await generateToolResponse(
      "Generate it.",
      { system: "Use the supplied function.", tools: [resultTool] },
      async (params) => {
        captured = params;
        return completion;
      },
    );

    assert.equal(captured?.tool_choice, "required");
    assert.deepEqual(response.calls, [
      { name: "submit_example", arguments: '{"value":"accepted"}' },
    ]);
    assert.deepEqual(response.metadata.usage, {
      inputTokens: 100,
      cachedInputTokens: 75,
      cacheWriteTokens: undefined,
      outputTokens: 20,
      totalTokens: 120,
    });
    assert.match(response.rawResponse, /completion-1/);
  });

  it("normalizes DeepSeek cache-hit and cache-write usage fields", async () => {
    const completion = {
      id: "completion-cache",
      model: "deepseek-model",
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            tool_calls: [
              {
                type: "function",
                function: {
                  name: "submit_example",
                  arguments: '{"value":"accepted"}',
                },
              },
            ],
          },
        },
      ],
      usage: {
        prompt_tokens: 100,
        prompt_cache_hit_tokens: 70,
        cache_creation_input_tokens: 10,
        completion_tokens: 20,
      },
    } as unknown as OpenAI.Chat.Completions.ChatCompletion;

    const response = await generateToolResponse(
      "Generate it.",
      { system: "Use the supplied function.", tools: [resultTool] },
      async () => completion,
    );

    assert.deepEqual(response.metadata.usage, {
      inputTokens: 100,
      cachedInputTokens: 70,
      cacheWriteTokens: 10,
      outputTokens: 20,
      totalTokens: 120,
    });
  });

  it("classifies OpenAI connection timeouts as transient", () => {
    assert.equal(
      isTransientError(new OpenAI.APIConnectionTimeoutError()),
      true,
    );
    assert.equal(isTransientError(new Error("validation failed")), false);
  });
});
