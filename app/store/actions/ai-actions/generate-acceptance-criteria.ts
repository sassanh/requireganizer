import { Step, StructuralFragment } from "store";

import { makeStructuralFragmentFlow } from "./makeStructuralFragmentFlow";

export default makeStructuralFragmentFlow({
  step: Step.AcceptanceCriteria,
  structuralFragment: StructuralFragment.AcceptanceCriteria,
  requirements: [
    "description",
    "productOverview",
    "requirements",
    "userStories",
  ],
});
