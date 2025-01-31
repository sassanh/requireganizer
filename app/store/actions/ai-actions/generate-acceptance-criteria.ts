import { toGenerator } from "mobx-state-tree";

import { generateStructuralFragment } from "actions/ai/generate-structural-fragment";
import { Step, StructuralFragment } from "store";

import { generator, handleFunctionCall } from "./utilities";

export default generator(
  function* generateAcceptanceCriteria(self) {
    self.resetValidationErrors();

    const { functionCall } = yield* toGenerator(
      generateStructuralFragment({
        state: self.json(Step.AcceptanceCriteria),
        structuralFragment: StructuralFragment.AcceptanceCriteria,
      }),
    );

    handleFunctionCall(self, functionCall);

    self.eventTarget.emit("stepUpdate", Step.AcceptanceCriteria);
  },
  {
    requirements: [
      "description",
      "productOverview",
      "requirements",
      "userStories",
    ],
  },
);
