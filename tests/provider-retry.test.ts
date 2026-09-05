import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

import type { AgentOptions } from "@earendil-works/pi-agent-core";
import type {
  AssistantMessage,
  AssistantMessageEvent,
  ToolCall,
} from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";

import { isRateLimitError, isTimeoutError, UserFacingError } from "../app/lib/errors";
import { Store } from "../app/store/store";
import type { Store as StoreInstance } from "../app/store/store";

const RATE_LIMIT_MESSAGE =
  'OpenAI API error (429): {"param":null,"code":"rate_limit_exceeded",' +
  '"type":"rate_limit_error","message":"Rate limit exceeded. ' +
  'Please retry after a brief wait."}';

function assistantMessage(content: AssistantMessage["content"]): AssistantMessage {
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

function scriptedStreamFn(responses: AssistantMessage[]) {
  let call = 0;
  const streamFn: NonNullable<AgentOptions["streamFn"]> = () => {
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
  return streamFn;
}

describe("retryable failure detection", () => {
  it("matches the provider's 429 rendering and body code", () => {
    assert.equal(isRateLimitError(new Error(RATE_LIMIT_MESSAGE)), true);
  });

  it("matches wrapped causes and status fields", () => {
    const leaf = new Error("(429): body");
    assert.equal(
      isRateLimitError(new Error("The AI request failed.", { cause: leaf })),
      true,
    );
    assert.equal(
      isRateLimitError(Object.assign(new Error("Denied."), { status: 429 })),
      true,
    );
  });

  it("ignores ordinary failures", () => {
    assert.equal(isRateLimitError(new Error("The gateway is unavailable.")), false);
    assert.equal(isRateLimitError(new UserFacingError("Approve X first.")), false);
    assert.equal(isRateLimitError(null), false);
  });
});

describe("timeout detection", () => {
  it("matches gateway timeouts and timeout wording", () => {
    assert.equal(
      isTimeoutError(new Error("OpenAI API error (504): Gateway Timeout")),
      true,
    );
    assert.equal(
      isTimeoutError(new Error("The AI proxy rejected the request (504).")),
      true,
    );
    assert.equal(isTimeoutError(new Error("Upstream request timed out.")), true);
    assert.equal(
      isTimeoutError(
        new Error("Failed.", { cause: new Error("socket timed out") }),
      ),
      true,
    );
  });

  it("ignores ordinary failures", () => {
    assert.equal(isTimeoutError(new Error("The gateway is unavailable.")), false);
    assert.equal(isTimeoutError(new Error(RATE_LIMIT_MESSAGE)), false);
    assert.equal(isTimeoutError(null), false);
  });
});

describe("retryable failure recovery", () => {
  it("speaks calmly, stays silent, and retries the same attempt", async (t) => {
    const errorSpy = mock.method(console, "error");
    t.after(() => errorSpy.mock.restore());

    const store = Store.create({ productOverview: {} }) as unknown as StoreInstance;
    const failing = assistantMessage([]);
    failing.stopReason = "error";
    failing.errorMessage = RATE_LIMIT_MESSAGE;

    await store.sendConversationMessage(
      { message: "What is the current stage?" },
      scriptedStreamFn([
        failing,
        assistantMessage([{ type: "text", text: "Product Overview is next." }]),
      ]),
    );

    assert.equal(
      store.validationErrors,
      "The AI provider hit its rate limit. Wait a moment, then try again.",
    );
    assert.equal(store.validationErrorDetails, null);
    assert.equal(errorSpy.mock.callCount(), 0);
    assert.equal(store.canRetryFailedOperation(), true);

    await store.retryFailedOperation();

    assert.equal(store.validationErrors, null);
    assert.equal(store.canRetryFailedOperation(), false);
    assert.match(
      JSON.stringify(store.conversation),
      /Product Overview is next/,
    );
  });

  it("still logs ordinary provider failures", async (t) => {
    const errorSpy = mock.method(console, "error");
    t.after(() => errorSpy.mock.restore());

    const store = Store.create({ productOverview: {} }) as unknown as StoreInstance;
    const failing = assistantMessage([]);
    failing.stopReason = "error";
    failing.errorMessage = "The gateway is unavailable.";

    await store.sendConversationMessage(
      { message: "What is the current stage?" },
      scriptedStreamFn([failing]),
    );

    assert.match(
      store.validationErrors ?? "",
      /Unable to answer the conversation\. Please try again\./,
    );
    // Diagnostics attach only in development; the test env keeps the
    // sentence clean, exactly as production does.
    assert.equal(store.validationErrorDetails, null);
    assert.equal(errorSpy.mock.callCount(), 1);
    assert.equal(store.canRetryFailedOperation(), false);
  });

  it("ignores a retry with nothing waiting", async () => {
    const store = Store.create({ productOverview: {} }) as unknown as StoreInstance;
    assert.equal(store.canRetryFailedOperation(), false);
    await store.retryFailedOperation();
    assert.equal(store.validationErrors, null);
  });

  it("retries a timed out attempt with the same calm handling", async (t) => {
    const errorSpy = mock.method(console, "error");
    t.after(() => errorSpy.mock.restore());

    const store = Store.create({ productOverview: {} }) as unknown as StoreInstance;
    const failing = assistantMessage([]);
    failing.stopReason = "error";
    failing.errorMessage = "OpenAI API error (504): Gateway Timeout";

    await store.sendConversationMessage(
      { message: "What is the current stage?" },
      scriptedStreamFn([
        failing,
        assistantMessage([{ type: "text", text: "Product Overview is next." }]),
      ]),
    );

    assert.equal(
      store.validationErrors,
      "The AI request timed out. Wait a moment, then try again.",
    );
    assert.equal(store.validationErrorDetails, null);
    assert.equal(errorSpy.mock.callCount(), 0);
    assert.equal(store.canRetryFailedOperation(), true);

    await store.retryFailedOperation();

    assert.equal(store.validationErrors, null);
    assert.equal(store.canRetryFailedOperation(), false);
    assert.match(
      JSON.stringify(store.conversation),
      /Product Overview is next/,
    );
  });
});
