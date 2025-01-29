import { toGenerator } from "mobx-state-tree";

import { Iteration, StructuralFragment } from "store";

import { generator, handleFunctionCall } from "./utilities";
import { generateStructuralFragment } from "actions/ai/generate-structural-fragment";

export default generator(
  function* generateRequirements(self) {
    self.resetValidationErrors();

    const { functionCall } = yield* toGenerator(
      generateStructuralFragment({
        state: self.json(Iteration.requirements),
        structuralFragment: StructuralFragment.requirement,
      }),
    );

    handleFunctionCall(self, functionCall);

    self.eventTarget.emit("iterationUpdate", Iteration.requirements);
  },
  { requirements: ["description", "productOverview"] },
);
