import { WorkflowStage, StructuralFragment } from "store";

import { makeStructuralFragmentFlow } from "./makeStructuralFragmentFlow";

export default makeStructuralFragmentFlow({
  step: WorkflowStage.UserStories,
  structuralFragment: StructuralFragment.UserStory,
  requirements: ["description", "productOverview"],
  requiredSteps: [WorkflowStage.ProductOverview],
});
