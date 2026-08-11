import { Instance, SnapshotIn, cast, types } from "mobx-state-tree";

import { StructuralFragment } from "store/constants";

import { StructuralFragmentModel } from "./StructuralFragment";
import { TestCase, TestCaseModel } from "./TestCase";

export type TestScenario = Instance<typeof TestScenarioModel>;

export const TestScenarioModel = types
  .compose(
    StructuralFragmentModel,
    types.model({
      testCases: types.array(TestCaseModel),
      type: types.optional(
        types.literal(StructuralFragment.TestScenario),
        StructuralFragment.TestScenario,
      ),
    }),
  )
  .views((self) => ({
    get scenarioTestStatuses() {
      const total = self.testCases.length;
      if (total === 0) return { "not-generated": 0, "generated": 0, "out-of-sync": 0, "generated-count": 0, "total-count": 0 };

      let generated = 0;
      let outOfSync = 0;
      let notGenerated = 0;

      self.testCases.forEach((tc) => {
        if (tc.testStatus === "generated") generated++;
        else if (tc.testStatus === "out-of-sync") outOfSync++;
        else notGenerated++;
      });

      return {
        "generated": (generated / total) * 100,
        "out-of-sync": (outOfSync / total) * 100,
        "not-generated": (notGenerated / total) * 100,
        "generated-count": generated,
        "total-count": total,
      };
    }
  }))
  .actions((self) => ({
    setTestCases(testCases: SnapshotIn<TestCase>[]) {
      self.testCases.clear();
      self.testCases = cast(testCases);
    },
    addTestCase() {
      self.testCases.push(TestCaseModel.create({ content: "New Test Case" }));
    },
    removeTestCase({ fragment: testCase }: { fragment: TestCase }) {
      self.testCases.remove(testCase);
    },
  }))
  .named("TestScenario");
