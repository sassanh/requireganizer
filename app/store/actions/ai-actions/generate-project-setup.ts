import { toGenerator } from "mobx-state-tree";

import { WorkflowStage } from "store";

import { generator } from "./utilities";

export default generator(
  function* generateProjectSetup(self, hint?: string) {
const { runAgentCommand } = yield* toGenerator(import("ai-agent/agent"));
    const trimmedHint = hint?.trim();
        yield* toGenerator(runAgentCommand(self, "generate project setup", {
      kind: "generate",
      stage: WorkflowStage.ProjectSetup,
      ...(trimmedHint != null && trimmedHint.length > 0 ? { hint: trimmedHint } : {}),
    }));
    self.eventTarget.emit("stepUpdate", WorkflowStage.ProjectSetup);
  },
  {
    operation: "generate project setup",
    requirements: [
      "boundaryDesign",
      "implementationProfile",
      "contractSuite",
      "testScenarios",
    ],
    targetStep: WorkflowStage.ProjectSetup,
  },
);
