import { toGenerator } from "mobx-state-tree";

import { generateImplementationProfile as generateImplementationProfileAction } from "actions/ai/generate-implementation-profile";
import { Step } from "store";

import { applyImplementationProfileProposal, consumeHarnessResult, generator } from "./utilities";

export default generator(
  function* generateImplementationProfile(self) {
    const result = yield* toGenerator(generateImplementationProfileAction({
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
