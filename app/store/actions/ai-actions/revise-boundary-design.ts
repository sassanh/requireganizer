import { toGenerator } from "mobx-state-tree";

import { generateBoundaryDesign as generateBoundaryDesignAction } from "actions/ai/generate-boundary-design";
import { Step } from "store";

import { applyBoundaryDesignProposal, consumeHarnessResult, generator } from "./utilities";

export default generator(
  function* reviseBoundaryDesign(self, comment: string) {
    const result = yield* toGenerator(generateBoundaryDesignAction({
      state: self.json(Step.BoundaryDesign),
      currentDesign: self.boundaryDesign,
      comment,
    }));
    const proposal = consumeHarnessResult(self, result);
    if (proposal == null) return;
    applyBoundaryDesignProposal(self, proposal);
  },
  {
    operation: "revise boundary design",
    requirements: ["boundaryDesign"],
    requiredSteps: [],
  },
);
