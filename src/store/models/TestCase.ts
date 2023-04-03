import { Instance, types } from "mobx-state-tree";

import { StructuralFragmentModel } from "./StructuralFragment";

export const TestCaseModel = types
  .compose(
    StructuralFragmentModel,
    types.model({
      type: types.optional(types.literal("TestCase"), "TestCase"),
    })
  )
  .named("TestCase");

export type TestCase = Instance<typeof TestCaseModel>;
