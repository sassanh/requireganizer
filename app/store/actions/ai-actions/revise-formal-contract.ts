import { toGenerator } from "mobx-state-tree";

import { WorkflowStage } from "store";

import {
  applyContractSuiteProposal,
  generator,
} from "./utilities";

export default generator(
  function* reviseFormalContract(
    self,
    target: { kind: "interface" | "subject" | "verification"; id: string },
    comment: string,
  ) {
const { runAgentCommand } = yield* toGenerator(import("ai-agent/agent"));
        yield* toGenerator(runAgentCommand(self, "revise formal contract", {
      kind: "revise",
      stage: WorkflowStage.InterfaceContracts,
      target,
      comment,
    }));
    self.eventTarget.emit("stepUpdate", WorkflowStage.InterfaceContracts);
  },
  {
    operation: "revise formal contract",
    requirements: ["boundaryDesign", "implementationProfile", "contractSuite"],
    requiredSteps: [],
  },
);
