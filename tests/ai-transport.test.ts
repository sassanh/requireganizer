import assert from "node:assert/strict";
import { describe, it } from "node:test";

import OpenAI from "openai";

import {
  AIChatCompletionParams,
  buildToolCompletionParams,
  consumeCompletionStream,
  generateToolResponse,
  isTransientError,
  resolveApiKey,
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
  it("prefers configured credentials and otherwise uses anonymous access", () => {
    assert.equal(
      resolveApiKey({
        AI_API_KEY: " provider-neutral ",
        OPENCODE_API_KEY: "opencode-specific",
      }),
      "provider-neutral",
    );
    assert.equal(
      resolveApiKey({ OPENCODE_API_KEY: " opencode-specific " }),
      "opencode-specific",
    );
    assert.equal(resolveApiKey({}), "public");
  });

  it("requests high reasoning effort on the default OpenCode model", () => {
    const params = buildToolCompletionParams("Generate it.", {
      system: "Use the supplied function.",
      tools: [resultTool],
    });

    assert.equal(params.tool_choice, "required");
    assert.equal(params.parallel_tool_calls, false);
    assert.equal("response_format" in params, false);
    assert.deepEqual(params.reasoning_effort, "high");
    assert.deepEqual(params.tools, [
      {
        type: "function",
        function: resultTool,
      },
    ]);
  });

  it("omits OpenCode reasoning controls for other provider targets", () => {
    const params = buildToolCompletionParams(
      "Generate it.",
      { system: "Use the supplied function.", tools: [resultTool] },
      {
        model: "provider-model",
        baseURL: "https://provider.example/v1",
      },
    );

    assert.equal(params.model, "provider-model");
    assert.equal("reasoning_effort" in params, false);
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

  it("treats provider HTTP 429 responses as transient", () => {
    const error = new OpenAI.RateLimitError(
      429,
      {
        type: "FreeUsageLimitError",
        message: "Rate limit exceeded.",
      },
      undefined,
      new Headers(),
    );
    assert.equal(isTransientError(error), true);
  });

  it("classifies user aborts as non-transient", () => {
    assert.equal(
      isTransientError(new OpenAI.APIUserAbortError()),
      false,
    );
  });

  it("accumulates streamed reasoning, content, and tool calls into a completion", async () => {
    const chunk = (
      delta: Record<string, unknown>,
      choiceOverrides: Record<string, unknown> = {},
      topLevel: Record<string, unknown> = {},
    ) =>
      ({
        id: "chunk-1",
        created: 123,
        model: "test-model",
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta, ...choiceOverrides }],
        ...topLevel,
      }) as unknown as OpenAI.Chat.Completions.ChatCompletionChunk;

    async function* stream() {
      yield chunk({ reasoning_content: "Let me " });
      yield chunk({ reasoning: "think." });
      yield chunk({
        tool_calls: [
          { index: 0, id: "call-1", function: { name: "submit_example" } },
        ],
      });
      yield chunk({
        tool_calls: [
          { index: 0, function: { arguments: '{"value":"ac' } },
        ],
      });
      yield chunk({
        content: "Done",
        tool_calls: [
          { index: 0, function: { arguments: 'cepted"}' } },
        ],
      });
      yield chunk({}, { finish_reason: "tool_calls" });
      yield chunk({}, { finish_reason: "tool_calls" }, {
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });
    }

    const thinking: string[] = [];
    const completion = await consumeCompletionStream(stream(), (delta) => {
      thinking.push(delta);
    });

    assert.deepEqual(thinking, ["Let me ", "think."]);
    assert.equal(completion.id, "chunk-1");
    assert.equal(completion.model, "test-model");
    assert.equal(completion.choices[0].finish_reason, "tool_calls");
    assert.deepEqual(completion.choices[0].message.tool_calls, [
      {
        id: "call-1",
        type: "function",
        function: {
          name: "submit_example",
          arguments: '{"value":"accepted"}',
        },
        index: 0,
      },
    ]);
    assert.equal(completion.choices[0].message.content, "Done");
    assert.deepEqual(completion.usage, {
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
    });
  });

  it("attaches the request id from the streaming response headers", async () => {
    async function* stream(): AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk> {}

    const completion = await consumeCompletionStream(
      Object.assign(stream(), {
        response: { headers: new Headers({ "x-request-id": "req-42" }) },
      }),
    );

    assert.equal(
      (completion as unknown as { _request_id?: string })._request_id,
      "req-42",
    );
  });
});
