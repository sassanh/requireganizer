import { Instance, SnapshotIn, cast, types } from "mobx-state-tree";

import type { TestScenarioBinding } from "contract-domain";
import { StructuralFragment } from "store/constants";
import { uuid } from "utilities";

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
      description: types.optional(types.string, ""),
      binding: types.maybeNull(types.frozen<TestScenarioBinding>()),
      revisionId: types.optional(types.string, uuid),
      revision: types.optional(types.number, 1),
    }),
  )
  .views((self) => ({
    get scenarioTestStatuses() {
      const total = self.testCases.length;
      if (total === 0) {
        return {
          "not-generated": 0,
          generated: 0,
          "out-of-sync": 0,
          "generated-count": 0,
          "total-count": 0,
        };
      }
      let generated = 0;
      let outOfSync = 0;
      let notGenerated = 0;
      self.testCases.forEach((testCase) => {
        if (testCase.testStatus === "generated") generated += 1;
        else if (testCase.testStatus === "out-of-sync") outOfSync += 1;
        else notGenerated += 1;
      });
      return {
        generated: (generated / total) * 100,
        "out-of-sync": (outOfSync / total) * 100,
        "not-generated": (notGenerated / total) * 100,
        "generated-count": generated,
        "total-count": total,
      };
    },
  }))
  .actions((self) => ({
    setTestCases(testCases: SnapshotIn<TestCase>[]) {
      self.testCases = cast(testCases);
    },
    setScenarioData({
      title,
      description,
      binding,
      revisionId,
      revision,
    }: {
      title: string;
      description: string;
      binding: TestScenarioBinding;
      revisionId?: string;
      revision?: number;
    }) {
      self.content = title;
      self.description = description;
      self.binding = cast(binding);
      self.revisionId = revisionId ?? uuid();
      self.revision = revision ?? self.revision + 1;
    },
  }))
  .named("TestScenario");
