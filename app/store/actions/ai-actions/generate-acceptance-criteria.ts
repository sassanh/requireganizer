import { WorkflowStage, StructuralFragment } from "store";

import { makeStructuralFragmentFlow } from "./makeStructuralFragmentFlow";

export default makeStructuralFragmentFlow({
  step: WorkflowStage.AcceptanceCriteria,
  structuralFragment: StructuralFragment.AcceptanceCriteria,
  requirements: [
    "productOverview",
    "requirements",
    "userStories",
  ],
});
