import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { applyOpToTree } from "../app/presentation/applyOp";
import { stepForSubject } from "../app/presentation/steps";
import { Step } from "../app/store/constants";

describe("presentation applyOp", () => {
  it("sets a scalar path", () => {
    const tree = applyOpToTree(
      { description: "", productOverview: { name: "" } },
      { kind: "update", subject: "description", value: "hello" },
    );
    assert.equal(tree.description, "hello");
  });

  it("sets a nested scalar", () => {
    const tree = applyOpToTree(
      { productOverview: { name: "", purpose: "" } },
      { kind: "update", subject: "productOverview/name", value: "Acme" },
    );
    assert.equal(
      (tree.productOverview as { name: string }).name,
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
      { stageInputFingerprints: { description: "abc" } },
      {
        kind: "update",
        subject: "stageInputFingerprints/description",
        value: undefined,
      },
    );
    assert.deepEqual(tree.stageInputFingerprints, {});
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

describe("presentation steps", () => {
  it("maps subjects to factory steps", () => {
    assert.equal(stepForSubject("description"), Step.Description);
    assert.equal(stepForSubject("productOverview/name"), Step.ProductOverview);
    assert.equal(stepForSubject("userStories/us-1"), Step.UserStories);
    assert.equal(
      stepForSubject("testScenarios/sc-1/testCases/tc-1"),
      Step.TestCases,
    );
    assert.equal(stepForSubject("testScenarios/sc-1"), Step.TestScenarios);
    assert.equal(stepForSubject("contractSuite"), Step.InterfaceContracts);
  });
});
