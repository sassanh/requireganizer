import { WorkflowStage, StructuralFragment } from "store";

import { makeStructuralFragmentFlow } from "./makeStructuralFragmentFlow";

export default makeStructuralFragmentFlow({
  step: WorkflowStage.Requirements,
  structuralFragment: StructuralFragment.Requirement,
  requirements: ["productOverview", "userStories"],
  requiredSteps: [WorkflowStage.UserStories],
});
