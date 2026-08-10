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
      title: types.optional(types.string, "New Test Case"),
      steps: types.optional(types.string, ""),
      expectedResult: types.optional(types.string, ""),
      lastGeneratedAt: types.maybeNull(types.number),
      lastModifiedAt: types.optional(types.number, () => Date.now()),
    }),
  )
  .views((self) => ({
    get testStatus(): "not-generated" | "generated" | "out-of-sync" {
      if (!self.lastGeneratedAt) return "not-generated";
      if (self.lastModifiedAt > self.lastGeneratedAt) return "out-of-sync";
      return "generated";
    }
  }))
  .actions((self) => ({
    setTitle(title: string) {
      self.title = title;
      self.lastModifiedAt = Date.now();
    },
    setSteps(steps: string) {
      self.steps = steps;
      self.lastModifiedAt = Date.now();
    },
    setExpectedResult(expectedResult: string) {
      self.expectedResult = expectedResult;
      self.lastModifiedAt = Date.now();
    },
    setLastGeneratedAt(timestamp: number) {
      self.lastGeneratedAt = timestamp;
    },
    setData(data: any) {
      if (data.title !== undefined) self.title = data.title;
      if (data.steps !== undefined) self.steps = data.steps;
      if (data.expectedResult !== undefined) self.expectedResult = data.expectedResult;

      if (data.priority !== undefined) self.setPriority(data.priority);
      if (data.references !== undefined) self.setReferences(data.references);
      if (data.dependencies !== undefined) self.setDependencies(data.dependencies);
      if (data.content !== undefined) self.setContent(data.content);
    }
  }))
  .named("TestCase");
