import { toGenerator } from "mobx-state-tree";

import { Step } from "store";

import {
  applyImplementationProfileProposal,
  consumeHarnessResult,
  generator,
  runAiOperation,
} from "./utilities";

export default generator(
  function* generateImplementationProfile(self) {
    const result = yield* toGenerator(runAiOperation(self, "generate-implementation-profile", {
      state: self.json(Step.InterfaceContracts),
    }));
    const proposal = consumeHarnessResult(self, result);
    if (proposal == null) return;
    applyImplementationProfileProposal(self, proposal);
  },
  {
    operation: "generate implementation profile",
    requirements: ["boundaryDesign"],
    requiredSteps: [Step.BoundaryDesign],
  },
);
