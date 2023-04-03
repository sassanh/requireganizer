import { Instance, types } from "mobx-state-tree";

import { StructuralFragmentModel } from "./StructuralFragment";
import { TestCase, TestCaseModel } from "./TestCase";

export const TestScenarioModel = types
  .compose(
    StructuralFragmentModel,
    types.model({
      testCases: types.array(TestCaseModel),
      type: types.optional(types.literal("TestScenario"), "TestScenario"),
    })
  )
  .actions((self) => ({
    addTestCase() {
      self.testCases.push(TestCaseModel.create({ content: "New Test Case" }));
    },
    removeTestCase(testCase: TestCase) {
      self.testCases.remove(testCase);
    },
  }))
  .named("TestScenario");

export type TestScenario = Instance<typeof TestScenarioModel>;
