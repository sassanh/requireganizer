import { toGenerator } from "mobx-state-tree";

import { Step } from "store";

import {
  applyProductOverviewProposal,
  consumeHarnessResult,
  generator,
  runAiOperation,
} from "./utilities";

export default generator(
  function* (self) {
    const result = yield* toGenerator(runAiOperation(
      self,
      "generate-product-overview",
      { state: self.json(Step.ProductOverview) },
    ));

    const proposal = consumeHarnessResult(self, result);
    if (proposal == null) return;
    applyProductOverviewProposal(self, proposal);
    self.eventTarget.emit("stepUpdate", Step.ProductOverview);
  },
  {
    operation: "generate the product overview",
    requirements: ["description"],
    requiredSteps: [Step.Description],
  },
);
