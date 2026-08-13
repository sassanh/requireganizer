import { toGenerator } from "mobx-state-tree";

import { generateBoundaryDesign as generateBoundaryDesignAction } from "actions/ai/generate-boundary-design";
import { Step } from "store";

import { applyBoundaryDesignProposal, consumeHarnessResult, generator } from "./utilities";

export default generator(
  function* generateBoundaryDesign(self) {
    const result = yield* toGenerator(generateBoundaryDesignAction({
      state: self.json(Step.BoundaryDesign),
    }));
    const proposal = consumeHarnessResult(self, result);
    if (proposal == null) return;
    applyBoundaryDesignProposal(self, proposal);
    self.eventTarget.emit("stepUpdate", Step.BoundaryDesign);
  },
  {
    operation: "generate boundary design",
    requirements: ["requirements", "acceptanceCriteria"],
    requiredSteps: [Step.AcceptanceCriteria],
  },
);
