import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { registerDomGlobals } from "./support/domGlobals";

/**
 * Reviewing with the mouse: the pointer lands on icons and buttons that
 * the review itself removes, so nothing may depend on where focus is.
 * react-dom loads after the DOM globals, so runtime imports happen inside
 * the tests.
 */
async function renderUnits(ids: string[]) {
  await registerDomGlobals();
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { Store, storeContext } = await import("../app/store/store");
  const { default: ApprovalMark } = await import("../app/components/ApprovalMark");
  const { ApprovalFrame } = await import("../app/components/ApprovalFrame");

  const store = Store.create({
    productOverview: {
      purpose: "Help people keep houseplants alive.",
      primaryFeatures: ids.map((id) => ({ id, content: `Feature ${id}` })),
      targetUsers: [{ id: "user-1", content: "Busy plant owners" }],
    },
  });
  store.setThreadAnswerer("coding-agent");
  const container = globalThis.document.createElement("div");
  globalThis.document.body.appendChild(container);
  const root = createRoot(container);
  await React.act(async () => {
    root.render(
      React.createElement(
        storeContext.Provider,
        { value: store },
        ids.map((id) =>
          React.createElement(ApprovalFrame, { key: id, elementId: id, approval: null }, React.createElement(ApprovalMark, { id })),
        ),
      ),
    );
  });
  const unmount = () => React.act(async () => root.unmount());
  return { React, store, container, unmount };
}

describe("reviewing with the mouse", () => {
  it("moves on from the approved item to the next one, wherever focus was", async () => {
    const { React, container, unmount } = await renderUnits(["feature-1", "feature-2", "feature-3"]);
    const approveButton = container.querySelector<HTMLElement>('[id="feature-2"] [data-action="approve-selected"]')!;
    await React.act(async () => {
      approveButton.click();
    });
    assert.equal(globalThis.document.activeElement?.id, "feature-3");
    await unmount();
  });

  it("sends a change request from the send icon", async () => {
    const { React, store, unmount } = await renderUnits(["feature-1"]);
    // Node has its own Event classes; the page's events come from its window.
    const view = globalThis.document.defaultView!;
    await React.act(async () => {
      globalThis.document.querySelector<HTMLElement>('[data-action="request-change"]')!.click();
    });
    const field = globalThis.document.querySelector<HTMLTextAreaElement>("[data-comment-popover] textarea")!;
    await React.act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")!.set!;
      setValue.call(field, "Shorter.");
      field.dispatchEvent(new view.Event("input", { bubbles: true }));
    });
    // The pointer goes down on the icon's SVG, not on the button.
    const icon = globalThis.document.querySelector('[data-action="send-change-request"] svg')!;
    await React.act(async () => {
      icon.dispatchEvent(new view.MouseEvent("mousedown", { bubbles: true }));
    });
    await React.act(async () => {
      icon.closest<HTMLButtonElement>("button")!.click();
    });
    assert.deepEqual(store.openThreadOf("feature-1")?.messages.map(({ text }) => text), ["Shorter."]);
    await unmount();
  });
});
