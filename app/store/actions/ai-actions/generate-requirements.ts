import { toGenerator } from "mobx-state-tree";

import { generateStructuralFragment } from "actions/ai/generate-structural-fragment";
import { Iteration, StructuralFragment } from "store";

import { generator, handleFunctionCall } from "./utilities";

export default generator(
  function* generateRequirements(self) {
    self.resetValidationErrors();

    const { functionCall } = yield* toGenerator(
      generateStructuralFragment({
        state: self.json(Iteration.requirements),
        structuralFragment: StructuralFragment.Requirement,
      }),
    );

    handleFunctionCall(self, functionCall);

    self.eventTarget.emit("iterationUpdate", Iteration.requirements);
  },
  { requirements: ["description", "productOverview"] },
);
