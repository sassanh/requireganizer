import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ElementType } from "react";

import type { Store as StoreInstance } from "../app/store/store";

/**
 * Component-level regression: a mounted observer tree must follow the store
 * through an AI-flow-style snapshot application and a timeline restore that
 * empties the rendered list. Guards against the class of bug where the store
 * updates but the UI stays stale until a remount.
 *
 * happy-dom globals must exist before react-dom loads, so every runtime
 * import happens inside the test body (type-only imports stay at the top).
 */
async function registerDomGlobals(): Promise<void> {
  const { Window } = await import("happy-dom");
  const window = new Window({ url: "http://localhost/" });
  for (const key of Object.getOwnPropertyNames(window)) {
    if (!(key in globalThis)) {
      try {
        (globalThis as unknown as Record<string, unknown>)[key] = (
          window as unknown as Record<string, unknown>
        )[key];
      } catch {
        // Some window accessors cannot be copied; skip them.
      }
    }
  }
  const assignGlobal = (key: string, value: unknown): void => {
    try {
      Object.defineProperty(globalThis, key, {
        value,
        writable: true,
        configurable: true,
      });
    } catch {
      // Some globals cannot be redefined; skip them.
    }
  };
  assignGlobal("window", window);
  assignGlobal("document", window.document);
  assignGlobal("navigator", window.navigator);
  assignGlobal("IS_REACT_ACT_ENVIRONMENT", true);
}

interface RenderedDom {
  container: HTMLElement;
  controlText: () => string;
  itemCount: () => number;
  unmount: () => void;
}

describe("product overview sync across restores", () => {
  it("re-renders the fragment list when a restore empties it", async () => {
    await registerDomGlobals();

    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { observer } = await import("mobx-react-lite");
    const { clone, getSnapshot, applySnapshot } = await import(
      "mobx-state-tree"
    );

    const { Store } = await import("../app/store/store");
    const { attachTimeline, undo } = await import(
      "../app/store/timeline/controller"
    );
    const StructuralFragmentsModule = await import(
      "../app/components/StructuralFragments"
    );

    const store: StoreInstance = Store.create({ productOverview: {} });
    attachTimeline(store);

    const ControlPane = observer(() =>
      React.createElement(
        "div",
        { id: "control" },
        `count=${store.productOverview.primaryFeatures.length}`,
      ),
    );

    const StructuralFragments = StructuralFragmentsModule.default as unknown as ElementType;

    const dom = await React.act(async (): Promise<RenderedDom> => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      root.render(
        React.createElement(
          React.StrictMode,
          null,
          React.createElement(ControlPane),
          React.createElement(StructuralFragments, {
            fragments: store.productOverview.primaryFeatures,
            isDisabled: false,
            structuralFragment: "primary_feature",
            onAddFragment: () => {},
            onComment: () => {},
            onRemoveFragment: () => {},
          }),
        ),
      );
      await Promise.resolve();
      return {
        container,
        controlText: () => {
          const element = container.querySelector("#control");
          assert.ok(element != null, "control pane is mounted");
          return element.textContent ?? "";
        },
        itemCount: () =>
          container.querySelectorAll("[data-fragment^='primary_feature:']")
            .length,
        unmount: () => {
          root.unmount();
          container.remove();
        },
      };
    });

    try {
      // The AI flow applies its proposal as clone -> mutate -> applySnapshot,
      // and the flow itself is a declared step: mirror both so the restore
      // below crosses a real generation turn.
      React.act(() => {
        const candidate = clone(store);
        candidate.productOverview.addPrimaryFeature();
        candidate.productOverview.addPrimaryFeature();
        applySnapshot(store, getSnapshot(candidate));
        store.setDescription({ description: "generated" });
      });

      assert.equal(store.productOverview.primaryFeatures.length, 2);
      assert.equal(dom.controlText(), "count=2");
      assert.equal(
        dom.itemCount(),
        2,
        `items missing; dom=${dom.container.innerHTML.slice(0, 600)}`,
      );

      React.act(() => {
        undo();
      });

      assert.equal(store.productOverview.primaryFeatures.length, 0);
      assert.equal(
        dom.controlText(),
        "count=0",
        "observer must follow the restored store",
      );
      assert.equal(
        dom.itemCount(),
        0,
        "the emptied fragment list must leave the DOM",
      );
    } finally {
      await React.act(async () => {
        dom.unmount();
      });
    }
  });
});
