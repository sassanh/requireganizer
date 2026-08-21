import { toGenerator } from "mobx-state-tree";

import { UserFacingError } from "lib/errors";
import { Step } from "store";

import {
  applyContractSuiteProposal,
  consumeHarnessResult,
  generator,
  runAiOperation,
} from "./utilities";

export default generator(
  function* generateInterfaceContracts(self) {
    if (self.implementationProfile.status !== "approved") {
      throw new UserFacingError("Approve the implementation profile before generating interface contracts.");
    }
    if (self.implementationProfile.boundaryRevisionId !== self.boundaryDesign.revisionId) {
      throw new UserFacingError(
        "Regenerate the implementation profile for the current Boundary Design before generating interface contracts.",
      );
    }
    const result = yield* toGenerator(runAiOperation(self, "generate-interface-contracts", {
      state: self.json(Step.InterfaceContracts),
      design: self.boundaryDesign,
      profile: self.implementationProfile,
    }));
    const proposal = consumeHarnessResult(self, result);
    if (proposal == null) return;
    applyContractSuiteProposal(self, proposal);
  },
  {
    operation: "generate interface contracts",
    requirements: ["boundaryDesign", "implementationProfile"],
    requiredSteps: [Step.BoundaryDesign],
  },
);
