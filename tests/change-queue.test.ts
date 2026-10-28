import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { registerDomGlobals } from "./support/domGlobals";

/**
 * Presenters animate the replica: one recorded frame at a time, displayed
 * copies holding previous values until their frame, human edits snapping.
 */
async function attachShown(store: import("../app/store/store").Store) {
  const { getSnapshot } = await import("mobx-state-tree");
  const { Store } = await import("../app/store/store");
  const {
    attachPresentation,
    resetPresentation,
    setPresentationNav,
  } = await import("../app/presentation");
  const { WorkflowStage } = await import("../app/store/constants");
  const { timelineChangeSource } = await import("../app/store/timeline/controller");
  resetPresentation();
  const shown = Store.create(getSnapshot(store));
  setPresentationNav({
    getStep: () => WorkflowStage.ProductOverview,
    requestStep: () => {},
    isVisible: () => true,
  });
  attachPresentation(shown, store, timelineChangeSource);
  return shown;
}

async function playMembershipTurn(React: typeof import("react")): Promise<void> {
  // Wait until the queue leaves the current tick, however long the turn's
  // slowest claimant takes. One call always plays exactly one turn: some
  // turns are shared (the list and a text field finish together), so no
  // single presenter's timer length fits them all.
  const { getPresentationTick } = await import("../app/presentation");
  const tick = getPresentationTick();
  const deadline = Date.now() + 5000;
  while (getPresentationTick() === tick && Date.now() < deadline) {
    await React.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
}

describe("change queue", () => {
  it("staged fields hold their values and play in recorded order", async () => {
    await registerDomGlobals();
    const { resetChangeQueue } = await import("../app/components/changeQueue");
    resetChangeQueue();

    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { observer } = await import("mobx-react-lite");
    const { Store } = await import("../app/store/store");
    const { attachTimeline, declareTimelineStep } = await import(
      "../app/store/timeline/controller"
    );
    const { useStagedContent } = await import("../app/components/changeQueue");

    declareTimelineStep("setProductOverview", {
      kind: "ai",
      label: "Generated product overview",
    });

    const store = Store.create({
      productOverview: { primaryFeatures: [{ id: "feat-1", content: "Old feature" }] },
    });
    attachTimeline(store);
    const shown = await attachShown(store);

    const finishHighlight: Record<string, () => void> = {};
    function makeAnchor(id: string): void {
      const anchor = globalThis.document.createElement("div");
      anchor.id = id;
      anchor.animate = ((_: unknown, __: unknown) => ({
        finished: new Promise<void>((resolve) => {
          finishHighlight[id] = resolve;
        }),
      })) as never;
      globalThis.document.body.appendChild(anchor);
    }
    makeAnchor("productOverview-purpose");
    makeAnchor("feat-1");

    const PurposeField = observer(() => {
      const displayed = useStagedContent(
        "productOverview/purpose",
        "productOverview-purpose",
        shown.productOverview.purpose || "",
      );
      return React.createElement(
        "output",
        { "data-field": "productOverview/purpose" },
        displayed,
      );
    });
    const FeatureField = observer(() => {
      const displayed = useStagedContent(
        "productOverview/primaryFeatures/feat-1",
        "feat-1",
        shown.productOverview.primaryFeatures[0]?.content ?? "",
      );
      return React.createElement(
        "output",
        { "data-field": "feat-1" },
        displayed,
      );
    });

    const container = globalThis.document.createElement("div");
    globalThis.document.body.appendChild(container);
    const root = createRoot(container);
    const textOf = (field: string): string =>
      container.querySelector(`[data-field="${field}"]`)?.textContent ?? "";

    await React.act(async () => {
      root.render(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(PurposeField),
          React.createElement(FeatureField),
        ),
      );
      await Promise.resolve();
    });
    assert.equal(textOf("productOverview/purpose"), "");
    assert.equal(textOf("feat-1"), "Old feature");

    await React.act(() => {
      store.setProductOverview({
        purpose: "Acme",
        primaryFeatures: [{ id: "feat-1", content: "Ship quality software" }],
        targetUsers: [],
      } as never);
    });

    assert.equal(textOf("productOverview/purpose"), "Acme", "first frame repaints");
    assert.equal(
      textOf("feat-1"),
      "Old feature",
      "the later field must hold its previous value while the earlier frame plays",
    );

    await React.act(async () => {
      finishHighlight["productOverview-purpose"]?.();
      await Promise.resolve();
    });
    assert.equal(textOf("feat-1"), "Ship quality software");

    await React.act(async () => {
      finishHighlight["feat-1"]?.();
      await Promise.resolve();
    });

    root.unmount();
    container.remove();
    for (const id of ["productOverview-purpose", "feat-1"]) {
      globalThis.document.getElementById(id)?.remove();
    }
  });

  it("recorded content edits of a list item hold then blink", async () => {
    await registerDomGlobals();
    const { resetChangeQueue } = await import("../app/components/changeQueue");
    resetChangeQueue();

    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { Store } = await import("../app/store/store");
    const { attachTimeline, declareTimelineStep } = await import(
      "../app/store/timeline/controller"
    );
    const StructuralFragmentsModule = await import(
      "../app/components/StructuralFragments"
    );

    declareTimelineStep("setUserStories", {
      kind: "ai",
      label: "Generated user stories",
    });

    const store = Store.create({
      productOverview: {},
      userStories: [
        { id: "us-1", content: "old one" },
        { id: "us-2", content: "old two" },
      ],
    });
    attachTimeline(store);
    const shown = await attachShown(store);

    const finishHighlight: Record<string, () => void> = {};
    function makeAnchor(id: string): void {
      const anchor = globalThis.document.createElement("div");
      anchor.id = id;
      anchor.animate = ((_: unknown, __: unknown) => ({
        finished: new Promise<void>((resolve) => {
          finishHighlight[id] = resolve;
        }),
      })) as never;
      globalThis.document.body.appendChild(anchor);
    }
    makeAnchor("us-1");
    makeAnchor("us-2");

    const StructuralFragments = StructuralFragmentsModule.default;
    const container = globalThis.document.createElement("div");
    globalThis.document.body.appendChild(container);
    const root = createRoot(container);
    const itemTexts = (): string[] =>
      [...container.querySelectorAll("[data-fragment^='user_story:']")].map(
        (card) =>
          (
            card.querySelector(
              "textarea.MuiInputBase-input",
            ) as HTMLTextAreaElement | null
          )?.value ?? "",
      );

    await React.act(async () => {
      root.render(
        React.createElement(StructuralFragments, {
          fragments: shown.userStories,
          isDisabled: false,
          structuralFragment: "user_story" as never,
        }),
      );
      await Promise.resolve();
    });
    assert.deepEqual(itemTexts(), ["old one", "old two"]);

    await React.act(() => {
      store.setUserStories({
        userStories: [
          { id: "us-1", content: "new one" },
          { id: "us-2", content: "new two" },
        ],
      });
    });
    assert.deepEqual(
      itemTexts(),
      ["new one", "old two"],
      "the later item must keep its previous content until its frame",
    );

    await React.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 900));
    });
    assert.deepEqual(itemTexts(), ["new one", "new two"]);

    await React.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 900));
    });

    root.unmount();
    container.remove();
    for (const id of ["us-1", "us-2"]) {
      globalThis.document.getElementById(id)?.remove();
    }
  });

  it("removed list items keep their content while they slide out", async () => {
    await registerDomGlobals();
    const { resetChangeQueue } = await import("../app/components/changeQueue");
    resetChangeQueue();

    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { Store } = await import("../app/store/store");
    const { attachTimeline, declareTimelineStep } = await import(
      "../app/store/timeline/controller"
    );
    const StructuralFragmentsModule = await import(
      "../app/components/StructuralFragments"
    );

    declareTimelineStep("setUserStories", {
      kind: "ai",
      label: "Generated user stories",
    });

    const store = Store.create({
      productOverview: {},
      userStories: [{ id: "us-1", content: "keep me visible" }],
    });
    attachTimeline(store);
    const shown = await attachShown(store);

    const StructuralFragments = StructuralFragmentsModule.default;
    const container = globalThis.document.createElement("div");
    globalThis.document.body.appendChild(container);
    const root = createRoot(container);
    const readText = (): string =>
      container.querySelector("textarea")?.value ??
      container.querySelector("textarea")?.textContent ??
      "";
    const itemCount = (): number =>
      container.querySelectorAll("[data-fragment^='user_story:']").length;

    await React.act(async () => {
      root.render(
        React.createElement(StructuralFragments, {
          fragments: shown.userStories,
          isDisabled: false,
          structuralFragment: "user_story" as never,
        }),
      );
      await Promise.resolve();
    });
    assert.equal(readText(), "keep me visible");
    assert.equal(itemCount(), 1);

    await React.act(() => {
      store.setUserStories({ userStories: [] });
    });
    assert.equal(store.userStories.length, 0);
    assert.equal(shown.userStories.length, 0);
    assert.equal(
      itemCount(),
      1,
      "the list must keep the leaving item mounted",
    );
    assert.equal(
      readText(),
      "keep me visible",
      "the leaving item must still show its content, not an empty shell",
    );

    await playMembershipTurn(React);
    assert.equal(itemCount(), 0);

    root.unmount();
    container.remove();
  });

  it("keeps waiting list adds in line when a later undo queues removes", async () => {
    await registerDomGlobals();
    const { resetChangeQueue } = await import("../app/components/changeQueue");
    resetChangeQueue();

    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { Store } = await import("../app/store/store");
    const { attachTimeline, declareTimelineStep } = await import(
      "../app/store/timeline/controller"
    );
    const StructuralFragmentsModule = await import(
      "../app/components/StructuralFragments"
    );

    declareTimelineStep("setUserStories", {
      kind: "ai",
      label: "Generated user stories",
    });

    const store = Store.create({ productOverview: {} });
    attachTimeline(store);
    const shown = await attachShown(store);

    const StructuralFragments = StructuralFragmentsModule.default;
    const container = globalThis.document.createElement("div");
    globalThis.document.body.appendChild(container);
    const root = createRoot(container);
    const itemTexts = (): string[] =>
      [...container.querySelectorAll("[data-fragment^='user_story:']")].map(
        (card) =>
          (
            card.querySelector(
              "textarea.MuiInputBase-input",
            ) as HTMLTextAreaElement | null
          )?.value ?? "",
      );

    await React.act(async () => {
      root.render(
        React.createElement(StructuralFragments, {
          fragments: shown.userStories,
          isDisabled: false,
          structuralFragment: "user_story" as never,
        }),
      );
      await Promise.resolve();
    });

    await React.act(() => {
      store.setUserStories({
        userStories: [
          { id: "us-1", content: "one" },
          { id: "us-2", content: "two" },
          { id: "us-3", content: "three" },
        ],
      });
    });
    assert.deepEqual(itemTexts(), ["one"]);

    await React.act(() => {
      store.setUserStories({ userStories: [] });
    });
    assert.deepEqual(itemTexts(), ["one"]);

    await playMembershipTurn(React);
    assert.deepEqual(itemTexts(), ["one", "two"]);
    await playMembershipTurn(React);
    assert.deepEqual(itemTexts(), ["one", "two", "three"]);
    await playMembershipTurn(React);
    assert.deepEqual(itemTexts(), ["one", "two", "three"]);
    await playMembershipTurn(React);
    assert.deepEqual(itemTexts(), ["one", "two"]);
    await playMembershipTurn(React);
    assert.deepEqual(itemTexts(), ["one"]);
    await playMembershipTurn(React);
    assert.deepEqual(itemTexts(), []);

    root.unmount();
    container.remove();
  });

  it("appends a later redo's adds after remaining adds and the undo's removes", async () => {
    await registerDomGlobals();
    const { resetChangeQueue } = await import("../app/components/changeQueue");
    resetChangeQueue();

    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { Store } = await import("../app/store/store");
    const { attachTimeline, declareTimelineStep, redo, undo } = await import(
      "../app/store/timeline/controller"
    );
    const StructuralFragmentsModule = await import(
      "../app/components/StructuralFragments"
    );

    declareTimelineStep("setUserStories", {
      kind: "ai",
      label: "Generated user stories",
    });

    const store = Store.create({ productOverview: {} });
    attachTimeline(store);
    const shown = await attachShown(store);

    const StructuralFragments = StructuralFragmentsModule.default;
    const container = globalThis.document.createElement("div");
    globalThis.document.body.appendChild(container);
    const root = createRoot(container);
    const itemTexts = (): string[] =>
      [...container.querySelectorAll("[data-fragment^='user_story:']")].map(
        (card) =>
          (
            card.querySelector(
              "textarea.MuiInputBase-input",
            ) as HTMLTextAreaElement | null
          )?.value ?? "",
      );

    await React.act(async () => {
      root.render(
        React.createElement(StructuralFragments, {
          fragments: shown.userStories,
          isDisabled: false,
          structuralFragment: "user_story" as never,
        }),
      );
      await Promise.resolve();
    });

    await React.act(() => {
      store.setUserStories({
        userStories: [
          { id: "us-1", content: "one" },
          { id: "us-2", content: "two" },
          { id: "us-3", content: "three" },
        ],
      });
    });
    await React.act(() => {
      undo();
    });
    await React.act(() => {
      redo();
    });
    assert.deepEqual(itemTexts(), ["one"]);

    await playMembershipTurn(React);
    await playMembershipTurn(React);
    assert.deepEqual(itemTexts(), ["one", "two", "three"]);
    await playMembershipTurn(React);
    await playMembershipTurn(React);
    assert.deepEqual(itemTexts(), ["one", "two"]);
    await playMembershipTurn(React);
    await playMembershipTurn(React);
    assert.deepEqual(itemTexts(), ["one"]);
    await playMembershipTurn(React);
    await playMembershipTurn(React);
    assert.deepEqual(itemTexts(), ["one", "two", "three"]);

    root.unmount();
    container.remove();
  });

  it("human edits repaint instantly without any queueing", async () => {
    await registerDomGlobals();
    const { resetChangeQueue } = await import("../app/components/changeQueue");
    resetChangeQueue();

    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { observer } = await import("mobx-react-lite");
    const { Store } = await import("../app/store/store");
    const { attachTimeline, declareTimelineStep } = await import(
      "../app/store/timeline/controller"
    );
    const { useStagedContent } = await import("../app/components/changeQueue");
    declareTimelineStep("setPurpose", { kind: "user", label: "setPurpose" });

    const store = Store.create({ productOverview: {} });
    attachTimeline(store);
    const shown = await attachShown(store);

    const Field = observer(function Field() {
      const displayed = useStagedContent(
        "productOverview/purpose",
        "productOverview-purpose",
        shown.productOverview.purpose || "",
      );
      return React.createElement("output", null, displayed);
    });

    const container = globalThis.document.createElement("div");
    globalThis.document.body.appendChild(container);
    const root = createRoot(container);
    const readText = (): string =>
      container.querySelector("output")?.textContent ?? "";

    await React.act(async () => {
      root.render(React.createElement(Field));
      await Promise.resolve();
    });

    await React.act(() => {
      store.setPurpose({ purpose: "typed" });
    });
    assert.equal(readText(), "typed");

    root.unmount();
    container.remove();
  });

  it("plays fields then list adds from the same recorded change in enqueue order", async () => {
    await registerDomGlobals();
    const { resetChangeQueue, useStagedContent } = await import(
      "../app/components/changeQueue"
    );
    resetChangeQueue();

    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { observer } = await import("mobx-react-lite");
    const { Store, storeContext } = await import("../app/store/store");
    const { attachTimeline, declareTimelineStep } = await import(
      "../app/store/timeline/controller"
    );
    const StructuralFragmentsModule = await import(
      "../app/components/StructuralFragments"
    );

    declareTimelineStep("setProductOverview", {
      kind: "ai",
      label: "Generated product overview",
    });

    const store = Store.create({ productOverview: {} });
    attachTimeline(store);
    const shown = await attachShown(store);

    const finishHighlight: Record<string, () => void> = {};
    function makeAnchor(id: string): void {
      const anchor = globalThis.document.createElement("div");
      anchor.id = id;
      anchor.animate = ((_: unknown, __: unknown) => ({
        finished: new Promise<void>((resolve) => {
          finishHighlight[id] = resolve;
        }),
      })) as never;
      globalThis.document.body.appendChild(anchor);
    }
    makeAnchor("productOverview-purpose");

    const PurposeField = observer(() => {
      const displayed = useStagedContent(
        "productOverview/purpose",
        "productOverview-purpose",
        shown.productOverview.purpose || "",
      );
      return React.createElement(
        "output",
        { "data-field": "productOverview/purpose" },
        displayed,
      );
    });

    const StructuralFragments = StructuralFragmentsModule.default;
    function Overview() {
      return React.createElement(
        React.Fragment,
        null,
        React.createElement(PurposeField),
        React.createElement(StructuralFragments, {
          fragments: shown.productOverview.primaryFeatures,
          isDisabled: false,
          structuralFragment: "primary_feature" as never,
        }),
      );
    }

    const container = globalThis.document.createElement("div");
    globalThis.document.body.appendChild(container);
    const root = createRoot(container);
    const textOf = (field: string): string =>
      container.querySelector(`[data-field="${field}"]`)?.textContent ?? "";
    const featureTexts = (): string[] =>
      [...container.querySelectorAll("[data-fragment^='primary_feature:']")].map(
        (card) =>
          (
            card.querySelector(
              "textarea.MuiInputBase-input",
            ) as HTMLTextAreaElement | null
          )?.value ?? "",
      );

    await React.act(async () => {
      root.render(
        React.createElement(
          storeContext.Provider,
          { value: store },
          React.createElement(Overview),
        ),
      );
      await Promise.resolve();
    });

    await React.act(() => {
      store.setProductOverview({
        purpose: "Ship quality software",
        primaryFeatures: [{ id: "pf-1", content: "feature one" }],
        targetUsers: [],
      } as never);
    });

    assert.equal(textOf("productOverview/purpose"), "Ship quality software");
    assert.deepEqual(
      featureTexts(),
      [],
      "list adds must wait for purpose's frame",
    );

    await React.act(async () => {
      finishHighlight["productOverview-purpose"]?.();
      await Promise.resolve();
    });
    assert.deepEqual(featureTexts(), ["feature one"]);

    root.unmount();
    container.remove();
    globalThis.document.getElementById("productOverview-purpose")?.remove();
  });
});
