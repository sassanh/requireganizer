import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getSnapshot } from "mobx-state-tree";

import { applyOpToStore, applyOpToTree } from "../app/presentation/applyOp";
import { stepForSubject } from "../app/presentation/steps";
import { WorkflowStage } from "../app/store/constants";
import { Store } from "../app/store/store";
import type { ChangeFocusOp } from "../app/store/timeline/controller";

describe("presentation applyOp", () => {
  it("sets a scalar path", () => {
    const tree = applyOpToTree(
      { title: "" },
      { kind: "update", subject: "title", value: "hello" },
    );
    assert.equal(tree.title, "hello");
  });

  it("sets a nested scalar", () => {
    const tree = applyOpToTree(
      { productOverview: { purpose: "" } },
      { kind: "update", subject: "productOverview/purpose", value: "Acme" },
    );
    assert.equal(
      (tree.productOverview as { purpose: string }).purpose,
      "Acme",
    );
  });

  it("adds and removes collection identities", () => {
    const added = applyOpToTree(
      { userStories: [] },
      {
        kind: "add",
        subject: "userStories/us-1",
        itemId: "us-1",
        itemSnapshot: { id: "us-1", content: "one" },
      },
    );
    assert.deepEqual(added.userStories, [{ id: "us-1", content: "one" }]);
    const removed = applyOpToTree(added, {
      kind: "remove",
      subject: "userStories/us-1",
      itemId: "us-1",
    });
    assert.deepEqual(removed.userStories, []);
  });

  it("drops undefined instead of writing it onto string fields", () => {
    const tree = applyOpToTree(
      { review: { "product-overview": "abc" } },
      {
        kind: "update",
        subject: "review/product-overview",
        value: undefined,
      },
    );
    assert.deepEqual(tree.review, {});
  });

  it("adds nested test cases by scenario id", () => {
    const tree = applyOpToTree(
      {
        testScenarios: [{ id: "sc-1", content: "s", testCases: [] }],
      },
      {
        kind: "add",
        subject: "testScenarios/sc-1/testCases/tc-1",
        itemId: "tc-1",
        itemSnapshot: { id: "tc-1", title: "t" },
      },
    );
    const scenario = (tree.testScenarios as { testCases: unknown[] }[])[0];
    assert.deepEqual(scenario.testCases, [{ id: "tc-1", title: "t" }]);
  });
});

describe("presentation applyOpToStore", () => {
  const FEATURES = "productOverview/primaryFeatures";

  function startingSnapshot() {
    return getSnapshot(
      Store.create({
        productOverview: {
          purpose: "Acme",
          primaryFeatures: [
            { id: "feat-1", content: "one" },
            { id: "feat-2", content: "two" },
          ],
        },
        systemMessage: "hello",
      }),
    );
  }

  function featureSnapshot(id: string, content: string) {
    const [first] = startingSnapshot().productOverview.primaryFeatures;
    return { ...first!, id, content };
  }

  /** The live store after an op matches the snapshot `applyOpToTree` makes from it. */
  function assertMatchesTree(op: ChangeFocusOp) {
    const store = Store.create(startingSnapshot());
    applyOpToStore(store, op);
    const expected = Store.create(applyOpToTree(startingSnapshot() as never, op) as never);
    assert.deepEqual(getSnapshot(store), getSnapshot(expected));
  }

  it("sets a nested scalar", () => {
    assertMatchesTree({ kind: "update", subject: "productOverview/purpose", value: "Beta" });
  });

  it("drops undefined instead of writing it", () => {
    assertMatchesTree({ kind: "update", subject: "systemMessage", value: undefined });
  });

  it("merges an item update into the item", () => {
    assertMatchesTree({
      kind: "update",
      subject: `${FEATURES}/feat-2`,
      itemId: "feat-2",
      itemSnapshot: { content: "changed" },
    });
  });

  it("adds an item after the item before it, or first", () => {
    for (const previousId of ["feat-1", null]) {
      assertMatchesTree({
        kind: "add",
        subject: `${FEATURES}/feat-3`,
        itemId: "feat-3",
        previousId,
        itemSnapshot: featureSnapshot("feat-3", "three"),
      });
    }
  });

  it("leaves an item that is already there", () => {
    assertMatchesTree({
      kind: "add",
      subject: `${FEATURES}/feat-1`,
      itemId: "feat-1",
      itemSnapshot: featureSnapshot("feat-1", "other"),
    });
  });

  it("removes an item and ignores one that is gone", () => {
    for (const itemId of ["feat-1", "feat-9"]) {
      assertMatchesTree({ kind: "remove", subject: `${FEATURES}/${itemId}`, itemId });
    }
  });

  it("changes only the item an item op names", () => {
    const store = Store.create(startingSnapshot());
    const untouched = store.productOverview.primaryFeatures[0];
    applyOpToStore(store, {
      kind: "update",
      subject: `${FEATURES}/feat-2`,
      itemId: "feat-2",
      itemSnapshot: { content: "changed" },
    });
    assert.equal(store.productOverview.primaryFeatures[0], untouched);
  });
});

describe("presentation steps", () => {
  it("maps subjects to factory steps", () => {
    assert.equal(stepForSubject("productOverview/purpose"), WorkflowStage.ProductOverview);
    assert.equal(stepForSubject("userStories/us-1"), WorkflowStage.UserStories);
    assert.equal(
      stepForSubject("testScenarios/sc-1/testCases/tc-1"),
      WorkflowStage.TestCases,
    );
    assert.equal(stepForSubject("testScenarios/sc-1"), WorkflowStage.TestScenarios);
    assert.equal(stepForSubject("contractSuite"), WorkflowStage.InterfaceContracts);
  });
});
