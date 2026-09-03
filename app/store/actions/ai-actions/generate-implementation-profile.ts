import { toGenerator } from "mobx-state-tree";

import { WorkflowStage } from "store";

import {
  applyImplementationProfileProposal,
  generator,
} from "./utilities";

export default generator(
  function* generateImplementationProfile(self, hint?: string) {
    const { runAgentCommand } = yield* toGenerator(import("ai-agent/agent"));
    const trimmedHint = hint?.trim();
    yield* toGenerator(runAgentCommand(self, "generate implementation profile", {
      kind: "generate",
      stage: "implementation-profile",
      ...(trimmedHint != null && trimmedHint.length > 0 ? { hint: trimmedHint } : {}),
    }));
    self.eventTarget.emit("stepUpdate", WorkflowStage.InterfaceContracts);
  },
  {
    operation: "generate implementation profile",
    requirements: ["boundaryDesign"],
    requiredSteps: [WorkflowStage.BoundaryDesign],
  },
);
