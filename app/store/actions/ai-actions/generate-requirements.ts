import { Step, StructuralFragment } from "store";

import { makeStructuralFragmentFlow } from "./makeStructuralFragmentFlow";

export default makeStructuralFragmentFlow({
  step: Step.Requirements,
  structuralFragment: StructuralFragment.Requirement,
  requirements: ["description", "productOverview"],
});
