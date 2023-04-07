import { Instance, types } from "mobx-state-tree";

import { StructuralFragmentModel } from "./StructuralFragment";

export type UserStory = Instance<typeof UserStoryModel>;

export const UserStoryModel = types
  .compose(
    StructuralFragmentModel,
    types.model({
      type: types.optional(types.literal("UserStory"), "UserStory"),
    })
  )
  .named("UserStory");
