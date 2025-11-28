import { toGenerator } from "mobx-state-tree";

import { generateStructuralFragment } from "actions/ai/generate-structural-fragment";
import { Step, StructuralFragment } from "store";

import { generator, handleFunctionCalls } from "./utilities";

export default generator(
  function* generateAcceptanceCriteria(self) {
    self.resetValidationErrors();

    const { functionCalls } = yield* toGenerator(
      generateStructuralFragment({
        state: self.json(Step.AcceptanceCriteria),
        structuralFragment: StructuralFragment.AcceptanceCriteria,
      }),
    );

    handleFunctionCalls(self, functionCalls);
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
