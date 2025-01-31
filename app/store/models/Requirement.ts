import { Instance, types } from "mobx-state-tree";

import { StructuralFragment } from "store";

import { StructuralFragmentModel } from "./StructuralFragment";

export type Requirement = Instance<typeof RequirementModel>;

export const RequirementModel = types
  .compose(
    StructuralFragmentModel,
    types.model({
      type: types.optional(
        types.literal(StructuralFragment.Requirement),
        StructuralFragment.Requirement,
      ),
    }),
  )
  .named("Requirement");
