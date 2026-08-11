import { Instance, types } from "mobx-state-tree";

import { StructuralFragment } from "store/constants";

import {
  StructuralFragmentModel,
  StructuralFragmentUpdate,
} from "./StructuralFragment";

interface TestCaseUpdate extends StructuralFragmentUpdate {
  title?: string;
  steps?: string;
  expectedResult?: string;
}

function referencesEqual(
  next: NonNullable<TestCaseUpdate["references"]>,
  current: ReadonlyArray<{ id: string; type: StructuralFragment }>,
): boolean {
  return (
    next.length === current.length &&
    next.every(
      (reference, index) =>
        reference.id === current[index].id &&
        reference.type === current[index].type,
    )
  );
}

function dependenciesEqual(
  next: NonNullable<TestCaseUpdate["dependencies"]>,
  current: ReadonlyArray<string>,
): boolean {
  return (
    next.length === current.length &&
    next.every((dependency, index) => dependency === current[index])
  );
}

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
    touch() {
      self.lastModifiedAt = Date.now();
    },
  }))
  .actions((self) => ({
    setTitle(title: string) {
      self.title = title;
      self.touch();
    },
    setSteps(steps: string) {
      self.steps = steps;
      self.touch();
    },
    setExpectedResult(expectedResult: string) {
      self.expectedResult = expectedResult;
      self.touch();
    },
    setLastGeneratedAt(timestamp: number) {
      self.lastGeneratedAt = timestamp;
    },
    setData(data: TestCaseUpdate) {
      let changed = false;

      if (data.title !== undefined && data.title !== self.title) {
        self.title = data.title;
        changed = true;
      }
      if (data.steps !== undefined && data.steps !== self.steps) {
        self.steps = data.steps;
        changed = true;
      }
      if (
        data.expectedResult !== undefined &&
        data.expectedResult !== self.expectedResult
      ) {
        self.expectedResult = data.expectedResult;
        changed = true;
      }
      if (data.priority !== undefined && data.priority !== self.priority) {
        self.setPriority(data.priority);
        changed = true;
      }
      if (
        data.references !== undefined &&
        !referencesEqual(data.references, self.references)
      ) {
        self.setReferences(data.references);
        changed = true;
      }
      if (
        data.dependencies !== undefined &&
        !dependenciesEqual(data.dependencies, self.dependencies)
      ) {
        self.setDependencies(data.dependencies);
        changed = true;
      }
      if (data.content !== undefined && data.content !== self.content) {
        self.setContent(data.content);
        changed = true;
      }

      if (changed) self.touch();
    }
  }))
  .named("TestCase");
