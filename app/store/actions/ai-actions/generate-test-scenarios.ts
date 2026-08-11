import { Step, StructuralFragment } from "store";

import { makeStructuralFragmentFlow } from "./makeStructuralFragmentFlow";

export default makeStructuralFragmentFlow({
  step: Step.TestScenarios,
  structuralFragment: StructuralFragment.TestScenario,
  requirements: [
    "description",
    "productOverview",
    "userStories",
    "requirements",
    "acceptanceCriteria",
  ],
  requiredSteps: [Step.AcceptanceCriteria],
});
