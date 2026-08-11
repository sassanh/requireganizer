import { toGenerator } from "mobx-state-tree";

import { generateStructuralFragment } from "actions/ai/generate-structural-fragment";
import { Step, StructuralFragment } from "store";
import { TestScenario } from "store/models";

import {
  applyArtifactListProposals,
  consumeHarnessResult,
  generator,
} from "./utilities";

export default generator(
  function* generateTestCases(self, testScenario?: TestScenario) {
    const testScenarios =
      testScenario == null ? self.testScenarios : [testScenario];
    const proposals = [];

    for (testScenario of testScenarios) {
      const result = yield* toGenerator(
        generateStructuralFragment({
          state: JSON.stringify({
            ...self.data(Step.AcceptanceCriteria),
            testScenarios: self.testScenarios.map((testScenario_) => ({
              id: testScenario_.id,
              type: testScenario_.type,
              content: testScenario_.content,
              priority: testScenario_.priority,
              references: testScenario_.references.map(({ id, type }) => ({
                id,
                type,
              })),
              dependencies: Array.from(testScenario_.dependencies),
              testCases:
                testScenario_ === testScenario
                  ? testScenario_.testCases.map((testCase_) => ({
                    id: testCase_.id,
                    type: testCase_.type,
                    content: testCase_.content,
                    title: testCase_.title,
                    steps: testCase_.steps,
                    expectedResult: testCase_.expectedResult,
                    priority: testCase_.priority,
                    references: testCase_.references.map(({ id, type }) => ({
                      id,
                      type,
                    })),
                    dependencies: Array.from(testCase_.dependencies),
                  }))
                  : [],
            })),
          }),
          parentId: testScenario.id,
          structuralFragment: StructuralFragment.TestCase,
        }),
      );

      const proposal = consumeHarnessResult(self, result);
      if (proposal == null) return;
      proposals.push(proposal);
    }
    applyArtifactListProposals(self, proposals);
    self.eventTarget.emit("stepUpdate", Step.TestCases);
  },
  {
    operation: "generate test cases",
    requirements: [
      "description",
      "productOverview",
      "userStories",
      "requirements",
      "acceptanceCriteria",
      "testScenarios",
    ],
    requiredSteps: [Step.TestScenarios],
  },
);
