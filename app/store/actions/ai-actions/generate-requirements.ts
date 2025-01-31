import { toGenerator } from "mobx-state-tree";

import { generateStructuralFragment } from "actions/ai/generate-structural-fragment";
import { Step, StructuralFragment } from "store";

import { generator, handleFunctionCall } from "./utilities";

export default generator(
  function* generateRequirements(self) {
    self.resetValidationErrors();

    const { functionCall } = yield* toGenerator(
      generateStructuralFragment({
        state: self.json(Step.Requirements),
        structuralFragment: StructuralFragment.Requirement,
      }),
    );

    handleFunctionCall(self, functionCall);

    self.eventTarget.emit("stepUpdate", Step.Requirements);
  },
  { requirements: ["description", "productOverview"] },
);
