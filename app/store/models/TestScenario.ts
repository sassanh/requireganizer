import { Instance, SnapshotIn, cast, types } from "mobx-state-tree";

import { StructrualFragment } from "store";

import { StructuralFragmentModel } from "./StructuralFragment";
import { TestCase, TestCaseModel } from "./TestCase";

export type TestScenario = Instance<typeof TestScenarioModel>;

export const TestScenarioModel = types
  .compose(
    StructuralFragmentModel,
    types.model({
      testCases: types.array(TestCaseModel),
      type: types.optional(
        types.literal(StructrualFragment.testScenario),
        StructrualFragment.testScenario
      ),
    })
  )
  .actions((self) => ({
    setTestCases(testCases: SnapshotIn<TestCase>[]) {
      self.testCases.clear();
      self.testCases = cast(testCases);
    },
    addTestCase() {
      self.testCases.push(TestCaseModel.create({ content: "New Test Case" }));
    },
    removeTestCase(testCase: TestCase) {
      self.testCases.remove(testCase);
    },
  }))
  .named("TestScenario");
