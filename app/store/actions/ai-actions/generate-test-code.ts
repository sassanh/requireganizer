import { toGenerator } from "mobx-state-tree";

import { UserFacingError } from "lib/errors";
import { WorkflowStage } from "store";
import type { TestCase, TestScenario } from "store/models";

import { generator } from "./utilities";

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
      throw new UserFacingError("Project Setup is stale. Refresh it before generating automated tests.");
    }
    if (testCase.approval !== "approved") {
      throw new UserFacingError("Approve this test case before generating the automated test.");
    }
    if (testCase.definition == null || testScenario.binding == null) {
      throw new UserFacingError("The selected case has no approved structured contract binding.");
    }
    const target = self.projectSetup.manifest.testTargets.find(
      ({ scenarioId }) => scenarioId === testScenario.id,
    );
    if (target == null) throw new UserFacingError("Project Setup has no test target for this scenario.");
    if (self.productOverview.name == null || self.productOverview.purpose == null) {
      throw new UserFacingError("Complete Product Overview first.");
    }
    if (testCase.inputFingerprint == null) throw new UserFacingError("The test case has no structured definition.");

const { runAgentCommand } = yield* toGenerator(import("ai-agent/agent"));
        yield* toGenerator(runAgentCommand(self, "generate automated test", {
      kind: "test-code",
      scenarioId: testScenario.id,
      testCaseId: testCase.id,
      comment,
    }));
    self.eventTarget.emit("stepUpdate", WorkflowStage.AutomatedTests);
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
    requiredSteps: [WorkflowStage.ProjectSetup],
  },
);
