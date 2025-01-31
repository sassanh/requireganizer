import { toGenerator } from "mobx-state-tree";

import { generateStructuralFragment } from "actions/ai/generate-structural-fragment";
import { Iteration, StructuralFragment } from "store";

import { generator, handleFunctionCall } from "./utilities";

export default generator(
  function* generateTestScenarios(self) {
    self.resetValidationErrors();

    const { functionCall } = yield* toGenerator(
      generateStructuralFragment({
        state: self.json(Iteration.testScenarios),
        structuralFragment: StructuralFragment.TestScenario,
      }),
    );

    handleFunctionCall(self, functionCall);

    self.eventTarget.emit("iterationUpdate", Iteration.testScenarios);
  },
  {
    requirements: [
      "description",
      "productOverview",
      "userStories",
      "requirements",
      "acceptanceCriteria",
    ],
  },
);
