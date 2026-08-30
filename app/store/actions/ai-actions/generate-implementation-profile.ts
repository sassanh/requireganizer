import { toGenerator } from "mobx-state-tree";

import { WorkflowStage } from "store";

import {
  applyImplementationProfileProposal,
  generator,
} from "./utilities";

export default generator(
  function* generateImplementationProfile(self) {
    const { runAgentCommand } = yield* toGenerator(import("ai-agent/agent"));
    yield* toGenerator(runAgentCommand(self, "generate implementation profile", {
      kind: "generate",
      stage: "implementation-profile",
    }));
    self.eventTarget.emit("stepUpdate", WorkflowStage.InterfaceContracts);
  },
  {
    operation: "generate implementation profile",
    requirements: ["boundaryDesign"],
    requiredSteps: [WorkflowStage.BoundaryDesign],
  },
);
