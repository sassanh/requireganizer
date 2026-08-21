import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { reaction } from "mobx";

import { Store } from "../app/store/store";

describe("thinking stream state", () => {
  it("notifies observers on every thinking append", () => {
    const store = Store.create({ productOverview: {} });
    const seen: string[] = [];
    const dispose = reaction(() => store.thinkingText, (text) => {
      seen.push(text);
    });

    store.beginAiOperation({
      operation: "generate test",
      controller: new AbortController(),
    });
    store.appendThinking("First");
    store.appendThinking(" Second");

    assert.deepEqual(seen, ["First", "First Second"]);
    assert.equal(store.thinkingLabel, "generate test");
    assert.equal(store.thinkingText, "First Second");
    dispose();
  });

  it("inserts segment dividers only between non-empty segments", () => {
    const store = Store.create({ productOverview: {} });
    store.beginAiOperation({
      operation: "generate test",
      controller: new AbortController(),
    });

    store.beginThinkingSegment();
    assert.equal(store.thinkingText, "");

    store.appendThinking("part one");
    store.beginThinkingSegment();
    assert.equal(store.thinkingText, "part one\n\n———\n\n");
  });

  it("ends the operation and clears the stream", () => {
    const store = Store.create({ productOverview: {} });
    const controller = new AbortController();
    store.beginAiOperation({ operation: "generate test", controller });
    store.appendThinking("partial");

    store.endAiOperation();
    assert.equal(store.thinkingLabel, null);
    assert.equal(store.thinkingText, "");
    assert.equal(store.aiAbortController, null);
  });

  it("aborting the operation aborts the active controller", () => {
    const store = Store.create({ productOverview: {} });
    const controller = new AbortController();
    store.beginAiOperation({ operation: "generate test", controller });

    store.abortAiOperation();
    assert.equal(controller.signal.aborted, true);
  });
});
