import { toGenerator } from "mobx-state-tree";

import { generateStructuralFragment } from "actions/ai/generate-structural-fragment";
import { Iteration, StructuralFragment } from "store";

import { generator, handleFunctionCall } from "./utilities";

export default generator(
  function* generateAcceptanceCriteria(self) {
    self.resetValidationErrors();

    const { functionCall } = yield* toGenerator(
      generateStructuralFragment({
        state: self.json(Iteration.acceptanceCriteria),
        structuralFragment: StructuralFragment.AcceptanceCriteria,
      }),
    );

    handleFunctionCall(self, functionCall);

    self.eventTarget.emit("iterationUpdate", Iteration.acceptanceCriteria);
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
