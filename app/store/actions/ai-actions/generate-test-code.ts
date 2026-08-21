import { toGenerator } from "mobx-state-tree";

import { UserFacingError } from "lib/errors";
import { Step } from "store";
import type { TestCase, TestScenario } from "store/models";

import {
  applyTestCodeProposal,
  consumeHarnessResult,
  generator,
  runAiOperation,
} from "./utilities";

export default generator(
  function* generateTestCode(
    self,
    {
      testCase,
      testScenario,
      comment,
    }: { testCase: TestCase; testScenario: TestScenario; comment?: string },
  ) {
    if (self.isProjectSetupOutdated) {
      throw new UserFacingError("Project Setup is stale. Review and regenerate it before generating automated tests.");
    }
    if (testCase.definition == null || testScenario.binding == null) {
      throw new UserFacingError("The selected case has no approved structured contract binding.");
    }
    const target = self.projectSetup.manifest.testTargets.find(
      ({ scenarioId }) => scenarioId === testScenario.id,
    );
    if (target == null) throw new UserFacingError("Project Setup has no test target for this scenario.");
    const existing = self.scaffoldFiles.find(({ path }) => path === target.path) ?? null;
    const name = self.productOverview.name;
    const purpose = self.productOverview.purpose;
    if (name == null || purpose == null) throw new UserFacingError("Complete Product Overview first.");

    const binding = testScenario.binding;
    const interfaceRevisionIds = binding.kind === "behavioral"
      ? binding.interfaceContractRevisionIds
      : [];
    const subjectRevisionIds = binding.kind === "behavioral"
      ? [binding.subjectContractRevisionId]
      : [];
    const interfaceContracts = self.contractSuite.interfaceContracts.filter(({ revisionId }) =>
      interfaceRevisionIds.includes(revisionId),
    );
    const subjectContracts = self.contractSuite.subjectContracts.filter(({ revisionId }) =>
      subjectRevisionIds.includes(revisionId),
    );
    const verificationContracts = binding.kind === "verification"
      ? self.contractSuite.verificationContracts.filter(
        ({ revisionId }) => revisionId === binding.verificationContractRevisionId,
      )
      : [];
    const inputFingerprint = testCase.inputFingerprint;
    if (inputFingerprint == null) throw new UserFacingError("The test case has no structured definition.");

    const result = yield* toGenerator(runAiOperation(self, "generate-test-code", {
      project: {
        name,
        purpose,
        language: self.implementationProfile.language,
        framework: self.implementationProfile.framework,
      },
      projectConfig: self.projectSetup.configuration as unknown as Record<string, unknown>,
      contracts: {
        boundaryRevisionId: self.boundaryDesign.revisionId,
        interfaceContracts,
        subjectContracts,
        verificationContracts,
      },
      scaffoldManifest: self.projectSetup.manifest as unknown as Record<string, unknown>,
      bindingMetadata: {
        adapterIds: interfaceContracts.map(({ adapter }) => `${adapter.id}@${adapter.version}`),
        interfaceContractRevisionIds: interfaceRevisionIds,
        subjectContractRevisionIds: subjectRevisionIds,
      },
      scenario: {
        id: testScenario.id,
        revisionId: testScenario.revisionId,
        code: testScenario.getCode(),
        content: `${testScenario.content}\n${testScenario.description}`,
        binding: testScenario.binding,
      },
      testCase: {
        id: testCase.id,
        revisionId: testCase.revisionId,
        code: testCase.getCode(),
        title: testCase.title,
        definition: testCase.definition,
        renderedSteps: testCase.steps,
        renderedExpectedResult: testCase.expectedResult,
      },
      targetPath: target.path,
      existingFile: existing == null ? null : { path: existing.path, content: existing.content },
      comment,
    }));
    const proposal = consumeHarnessResult(self, result);
    if (proposal == null) return;
    applyTestCodeProposal(self, proposal, testCase.id, inputFingerprint);
    self.eventTarget.emit("stepUpdate", Step.AutomatedTests);
  },
  {
    operation: "generate automated test",
    requirements: [
      "boundaryDesign",
      "implementationProfile",
      "contractSuite",
      "projectSetup",
      "testScenarios",
    ],
    requiredSteps: [Step.ProjectSetup],
  },
);
