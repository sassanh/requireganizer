import { toGenerator } from "mobx-state-tree";

import { Step } from "store";

import {
  applyContractSuiteProposal,
  consumeHarnessResult,
  generator,
  runAiOperation,
} from "./utilities";

export default generator(
  function* reviseFormalContract(
    self,
    target: { kind: "interface" | "subject" | "verification"; id: string },
    comment: string,
  ) {
    const result = yield* toGenerator(runAiOperation(self, "generate-interface-contracts", {
      state: self.json(Step.InterfaceContracts),
      design: self.boundaryDesign,
      profile: self.implementationProfile,
      currentSuite: self.contractSuite,
      revisionTarget: target,
      comment,
    }));
    const proposal = consumeHarnessResult(self, result);
    if (proposal == null) return;
    applyContractSuiteProposal(self, proposal);
  },
  {
    operation: "revise formal contract",
    requirements: ["boundaryDesign", "implementationProfile", "contractSuite"],
    requiredSteps: [],
  },
);
