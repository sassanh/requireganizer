import { toGenerator } from "mobx-state-tree";

import { generateStructuralFragment } from "actions/ai/generate-structural-fragment";
import { Step, StructuralFragment } from "store";

import { generator, handleFunctionCalls } from "./utilities";

export default generator(
  function* generateRequirements(self) {
    self.resetValidationErrors();

    const { functionCalls } = yield* toGenerator(
      generateStructuralFragment({
        state: self.json(Step.Requirements),
        structuralFragment: StructuralFragment.Requirement,
      }),
    );

    handleFunctionCalls(self, functionCalls);
    self.eventTarget.emit("stepUpdate", Step.Requirements);
  },
  { requirements: ["description", "productOverview"] },
);
