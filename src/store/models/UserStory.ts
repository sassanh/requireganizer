import { Instance, types } from "mobx-state-tree";

import { StructuralFragmentModel } from "./StructuralFragment";

export const UserStoryModel = types
  .compose(
    StructuralFragmentModel,
    types.model({
      type: types.optional(types.literal("UserStory"), "UserStory"),
    })
  )
  .named("UserStory");

export type UserStory = Instance<typeof UserStoryModel>;
