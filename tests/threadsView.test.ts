import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { registerDomGlobals } from "./support/domGlobals";

/**
 * A unit's thread shows whose turn it is on the unit itself, and a thread
 * waiting on the person marks the unit's frame. react-dom loads after the
 * DOM globals, so runtime imports happen inside the test.
 */
describe("change request thread state", () => {
  it("says who the thread waits for, and marks the units waiting on the person", async () => {
    await registerDomGlobals();
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { Store, storeContext } = await import("../app/store/store");
    const { default: ApprovalMark } = await import("../app/components/ApprovalMark");

    const store = Store.create({
      productOverview: {
        purpose: "Help people keep houseplants alive.",
        primaryFeatures: [{ id: "feature-1", content: "Track watering" }],
        targetUsers: [{ id: "user-1", content: "Busy plant owners" }],
      },
    });
    store.setThreadAnswerer("coding-agent");
    const threadId = store.requestChange("user-1", "Say who they are.");

    const container = globalThis.document.createElement("div");
    globalThis.document.body.appendChild(container);
    const root = createRoot(container);
    await React.act(async () => {
      root.render(
        React.createElement(storeContext.Provider, { value: store }, React.createElement(ApprovalMark, { id: "user-1" })),
      );
    });
    const state = () => container.querySelector("[data-thread-state]");
    assert.equal(state()?.textContent, "Waiting for the coding agent");
    assert.equal(state()?.hasAttribute("data-thread-waiting"), false);

    await React.act(async () => {
      store.answerThreads([{ threadId, text: "Who do you mean?" }], { kind: "agent", name: "Claude Code" });
    });
    assert.equal(state()?.textContent, "Waiting for you");
    assert.equal(state()?.hasAttribute("data-thread-waiting"), true);

    await React.act(async () => {
      store.resolveThread(threadId);
    });
    assert.equal(state(), null);
    await React.act(async () => root.unmount());
  });
});
