import { toGenerator } from "mobx-state-tree";

import { Step } from "store";

import {
  applyBoundaryDesignProposal,
  consumeHarnessResult,
  generator,
  runAiOperation,
} from "./utilities";

export default generator(
  function* generateBoundaryDesign(self) {
    const result = yield* toGenerator(runAiOperation(self, "generate-boundary-design", {
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
