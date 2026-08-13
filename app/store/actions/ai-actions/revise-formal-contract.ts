import { toGenerator } from "mobx-state-tree";

import { generateInterfaceContracts as generateInterfaceContractsAction } from "actions/ai/generate-interface-contracts";
import { Step } from "store";

import { applyContractSuiteProposal, consumeHarnessResult, generator } from "./utilities";

export default generator(
  function* reviseFormalContract(
    self,
    target: { kind: "interface" | "subject" | "verification"; id: string },
    comment: string,
  ) {
    const result = yield* toGenerator(generateInterfaceContractsAction({
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
