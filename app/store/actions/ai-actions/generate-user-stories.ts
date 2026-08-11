import { Step, StructuralFragment } from "store";

import { makeStructuralFragmentFlow } from "./makeStructuralFragmentFlow";

export default makeStructuralFragmentFlow({
  step: Step.UserStories,
  structuralFragment: StructuralFragment.UserStory,
  requirements: ["description", "productOverview"],
  requiredSteps: [Step.ProductOverview],
});
