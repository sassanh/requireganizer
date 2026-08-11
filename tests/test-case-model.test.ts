import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Priority } from "../app/store/constants";
import { TestCaseModel } from "../app/store/models/TestCase";
import { TestScenarioModel } from "../app/store/models/TestScenario";

describe("test-case reconciliation state", () => {
  it("does not mark unchanged generated test cases as modified", () => {
    const testCase = TestCaseModel.create({
      id: "case-1",
      content: "",
      title: "Adds two values",
      steps: "1. Add 1 and 2.",
      expectedResult: "The result is 3.",
      priority: Priority.P0,
      references: [],
      dependencies: [],
      lastGeneratedAt: 200,
      lastModifiedAt: 100,
    });

    testCase.setData({
      content: "",
      title: "Adds two values",
      steps: "1. Add 1 and 2.",
      expectedResult: "The result is 3.",
      priority: Priority.P0,
      references: [],
      dependencies: [],
    });

    assert.equal(testCase.lastModifiedAt, 100);
    assert.equal(testCase.testStatus, "generated");
  });

  it("retains nested test cases when an existing scenario is revised", () => {
    const scenario = TestScenarioModel.create({
      id: "scenario-1",
      content: "Original scenario",
      priority: Priority.P0,
      references: [],
      dependencies: [],
      testCases: [
        {
          id: "case-1",
          content: "",
          title: "Existing case",
          steps: "1. Execute.",
          expectedResult: "It passes.",
          priority: Priority.P0,
          references: [],
          dependencies: [],
          lastGeneratedAt: 200,
          lastModifiedAt: 100,
        },
      ],
    });

    scenario.setData({ content: "Revised scenario" });

    assert.equal(scenario.testCases.length, 1);
    assert.equal(scenario.testCases[0].id, "case-1");
    assert.equal(scenario.testCases[0].lastGeneratedAt, 200);
  });
});
