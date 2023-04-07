import { Instance, types } from "mobx-state-tree";

import { StructuralFragmentModel } from "./StructuralFragment";

export type Requirement = Instance<typeof RequirementModel>;

export const RequirementModel = types
  .compose(
    StructuralFragmentModel,
    types.model({
      type: types.optional(types.literal("Requirement"), "Requirement"),
    })
  )
  .named("Requirement");
