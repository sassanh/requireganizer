import { toGenerator } from "mobx-state-tree";

import { generateStructuralFragment } from "actions/ai/generate-structural-fragment";
import { Step, StructuralFragment } from "store";

import { generator, handleFunctionCall } from "./utilities";

export default generator(
  function* generateTestScenarios(self) {
    self.resetValidationErrors();

    const { functionCall } = yield* toGenerator(
      generateStructuralFragment({
        state: self.json(Step.TestScenarios),
        structuralFragment: StructuralFragment.TestScenario,
      }),
    );

    handleFunctionCall(self, functionCall);

    self.eventTarget.emit("stepUpdate", Step.TestScenarios);
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
