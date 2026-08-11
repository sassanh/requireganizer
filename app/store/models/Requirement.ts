import { Instance } from "mobx-state-tree";

import { StructuralFragment } from "store";

import { createStructuralFragmentModel } from "./StructuralFragment";

export const RequirementModel = createStructuralFragmentModel(
  "Requirement",
  StructuralFragment.Requirement,
);

export type Requirement = Instance<typeof RequirementModel>;
