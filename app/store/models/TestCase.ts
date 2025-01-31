import { Instance, types } from "mobx-state-tree";

import { StructuralFragment } from "store";

import { StructuralFragmentModel } from "./StructuralFragment";

export type TestCase = Instance<typeof TestCaseModel>;

export const TestCaseModel = types
  .compose(
    StructuralFragmentModel,
    types.model({
      type: types.optional(
        types.literal(StructuralFragment.TestCase),
        StructuralFragment.TestCase,
      ),
    }),
  )
  .named("TestCase");
