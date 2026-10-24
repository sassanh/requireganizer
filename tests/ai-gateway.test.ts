import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { StreamFn } from "@earendil-works/pi-agent-core";
import {
  type AssistantMessageEvent,
  createAssistantMessageEventStream,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";

import { createGatewayStream, gatewayStream, installGateway } from "../app/ai-agent/gateway";
import {
  type AiSettings,
  configureAiSettings,
  DEFAULT_AI_SETTINGS,
  fixedAiSettings,
  reviewerModel,
  writerModel,
} from "../app/ai-agent/settings";
import { createBrowserAiSettings, parseStoredAiSettings } from "../app/lib/aiSettingsStorage";
import { UserFacingError } from "../app/lib/errors";

const MESSAGES = {
  missingApiKeyMessage: "Add a key.",
  missingReviewerModelMessage: "Add a reviewer.",
};

function useSettings(settings: AiSettings): void {
  configureAiSettings(fixedAiSettings(settings, MESSAGES));
}

async function collect(stream: AsyncIterable<AssistantMessageEvent>): Promise<AssistantMessageEvent[]> {
  const events: AssistantMessageEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

function recordingRequest() {
  const calls: SimpleStreamOptions[] = [];
  const request: StreamFn = (_model, _context, options) => {
    calls.push(options ?? {});
    const stream = createAssistantMessageEventStream();
    stream.end();
    return stream;
  };
  return { request, calls };
}

describe("AI gateway", () => {
  it("calls the endpoint with the configured key and asks for detailed reasoning", async () => {
    useSettings({ ...DEFAULT_AI_SETTINGS, apiKey: "secret" });
    const { request, calls } = recordingRequest();
    await collect(await createGatewayStream(request)(writerModel(), { messages: [] }));
    assert.equal(calls.length, 1);
    const [options] = calls;
    assert.equal(options!.apiKey, "secret");
    assert.equal(typeof options!.fetch, "function");
    assert.deepEqual(
      options!.onPayload?.({ model: "m", reasoning: { effort: "high" } }, writerModel()),
      { model: "m", reasoning: { effort: "high", summary: "detailed" } },
    );
    assert.equal(options!.onPayload?.({ model: "m" }, writerModel()), undefined);
  });

  it("reads the key when each turn starts, so a changed setting applies at once", async () => {
    const { request, calls } = recordingRequest();
    const stream = createGatewayStream(request);
    useSettings({ ...DEFAULT_AI_SETTINGS, apiKey: "first" });
    await collect(await stream(writerModel(), { messages: [] }));
    useSettings({ ...DEFAULT_AI_SETTINGS, apiKey: "second" });
    await collect(await stream(writerModel(), { messages: [] }));
    assert.deepEqual(calls.map((options) => options.apiKey), ["first", "second"]);
  });

  it("starts no turn before a provider client is installed or while no API key is set", () => {
    useSettings({ ...DEFAULT_AI_SETTINGS, apiKey: "" });
    assert.throws(() => gatewayStream(), /AI runtime is not installed/);
    const { request, calls } = recordingRequest();
    installGateway(request);
    // The person learns where to add a key; no request is sent.
    assert.throws(
      () => gatewayStream(),
      (error: unknown) => error instanceof UserFacingError && error.message === "Add a key.",
    );
    assert.equal(calls.length, 0);
    useSettings({ ...DEFAULT_AI_SETTINGS, apiKey: "secret" });
    assert.equal(typeof gatewayStream(), "function");
  });

  it("builds the writer and reviewer models on the configured endpoint", () => {
    const settings: AiSettings = {
      baseUrl: "https://models.example.com/v1",
      apiKey: "secret",
      model: "writer",
      reviewerModel: "reviewer",
    };
    const writer = writerModel(settings);
    assert.equal(writer.id, "writer");
    assert.equal(writer.baseUrl, "https://models.example.com/v1");
    assert.equal(writer.provider, "models.example.com");
    assert.equal(reviewerModel(settings)?.id, "reviewer");
    assert.equal(reviewerModel({ ...settings, reviewerModel: null }), null);
  });
});

describe("browser AI settings", () => {
  it("falls back to the defaults for missing or malformed fields", () => {
    assert.deepEqual(parseStoredAiSettings(null), DEFAULT_AI_SETTINGS);
    assert.deepEqual(parseStoredAiSettings("not json"), DEFAULT_AI_SETTINGS);
    assert.deepEqual(
      parseStoredAiSettings(JSON.stringify({ baseUrl: " ", apiKey: 4, model: "m", reviewerModel: "" })),
      { ...DEFAULT_AI_SETTINGS, model: "m" },
    );
    // An endpoint that is not a URL is never called; the default is.
    assert.equal(parseStoredAiSettings(JSON.stringify({ baseUrl: "openrouter.ai/api/v1" })).baseUrl, DEFAULT_AI_SETTINGS.baseUrl);
    assert.deepEqual(
      parseStoredAiSettings(JSON.stringify({
        baseUrl: " https://example.com/v1 ",
        apiKey: "key",
        model: "m",
        reviewerModel: "r",
      })),
      { baseUrl: "https://example.com/v1", apiKey: "key", model: "m", reviewerModel: "r" },
    );
  });

  it("saves to browser storage, notifies subscribers, and reads the same object back", () => {
    const items = new Map<string, string>();
    const storageListeners: ((event: { key: string }) => void)[] = [];
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: {
          getItem: (key: string) => items.get(key) ?? null,
          setItem: (key: string, value: string) => items.set(key, value),
          removeItem: (key: string) => items.delete(key),
        },
        addEventListener: (_type: string, listener: (event: { key: string }) => void) =>
          storageListeners.push(listener),
        removeEventListener: () => {},
      },
    });
    try {
      const settings = createBrowserAiSettings();
      assert.equal(settings.read(), settings.read());
      let notified = 0;
      const unsubscribe = settings.subscribe(() => {
        notified += 1;
      });
      const saved: AiSettings = { ...DEFAULT_AI_SETTINGS, apiKey: "key", reviewerModel: "r" };
      settings.save(saved);
      assert.equal(notified, 1);
      assert.deepEqual(settings.read(), saved);
      assert.equal(settings.read(), settings.read());
      // A save in another tab arrives as a storage event.
      for (const listener of storageListeners) listener({ key: "requireganizer:ai-settings" });
      for (const listener of storageListeners) listener({ key: "something-else" });
      assert.equal(notified, 2);
      unsubscribe();
    } finally {
      Reflect.deleteProperty(globalThis, "window");
    }
  });
});
