import { toGenerator } from "mobx-state-tree";

import { UserFacingError } from "lib/errors";
import { WorkflowStage } from "store";

import {
  applyContractSuiteProposal,
  generator,
} from "./utilities";

export default generator(
  function* generateInterfaceContracts(self) {
    const { runAgentCommand } = yield* toGenerator(import("ai-agent/agent"));
    if (self.implementationProfile.boundaryRevisionId !== self.boundaryDesign.revisionId) {
      throw new UserFacingError(
        "Regenerate the implementation profile for the current Boundary Design before generating interface contracts.",
      );
    }
    yield* toGenerator(runAgentCommand(self, "generate interface contracts", {
      kind: "generate",
      stage: WorkflowStage.InterfaceContracts,
    }));
    self.eventTarget.emit("stepUpdate", WorkflowStage.InterfaceContracts);
  },
  {
    operation: "generate interface contracts",
    requirements: ["boundaryDesign", "implementationProfile"],
    requiredSteps: [WorkflowStage.BoundaryDesign],
  },
);
