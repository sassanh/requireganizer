import { toGenerator } from "mobx-state-tree";

import { Step } from "store";

import {
  applyBoundaryDesignProposal,
  consumeHarnessResult,
  generator,
  runAiOperation,
} from "./utilities";

export default generator(
  function* reviseBoundaryDesign(self, comment: string) {
    const result = yield* toGenerator(runAiOperation(self, "generate-boundary-design", {
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
