/* eslint-disable sort-exports/sort-exports */
import { IStateTreeNode } from "mobx-state-tree";
import { OmitFirstParameter, fromEntries } from "utilities";

import { Store } from "./store";

export enum Iteration {
  description = "description",
  productOverview = "product-overview",
  userStories = "user-stories",
  requirements = "requirements",
  acceptanceCriteria = "acceptance-criteria",
  testScenarios = "test-scenarios",
  testCases = "test-cases",
}
export const ITERATIONS = Object.values(Iteration);
export const ITERATION_LABELS = new Map([
  [Iteration.description, "Description"],
  [Iteration.productOverview, "Product Overview"],
  [Iteration.userStories, "User Stories"],
  [Iteration.requirements, "Requirements"],
  [Iteration.acceptanceCriteria, "Acceptance Criteria"],
  [Iteration.testScenarios, "Test Scenarios"],
  [Iteration.testCases, "Test Cases"],
]);

export enum StructrualFragment {
  userStory = "user-story",
  requirement = "requirement",
  acceptanceCriteria = "acceptance-criteria",
  testScenario = "test-scenario",
  testCase = "test-case",
}

export const STRUCTURAL_FRAGMENT_LABELS = new Map([
  [StructrualFragment.userStory, "User Story"],
  [StructrualFragment.requirement, "Requirement"],
  [StructrualFragment.acceptanceCriteria, "Acceptance Criteria"],
  [StructrualFragment.testScenario, "Test Scenario"],
  [StructrualFragment.testCase, "Test Case"],
]);

export const ITERATION_BY_STRUCTURAL_FRAGMENT = new Map([
  [StructrualFragment.userStory, Iteration.userStories],
  [StructrualFragment.requirement, Iteration.requirements],
  [StructrualFragment.acceptanceCriteria, Iteration.acceptanceCriteria],
  [StructrualFragment.testScenario, Iteration.testScenarios],
  [StructrualFragment.testCase, Iteration.testCases],
]);
export const STRUCTURAL_FRAGMENT_BY_ITERATION = new Map([
  [Iteration.userStories, StructrualFragment.userStory],
  [Iteration.requirements, StructrualFragment.requirement],
  [Iteration.acceptanceCriteria, StructrualFragment.acceptanceCriteria],
  [Iteration.testScenarios, StructrualFragment.testScenario],
  [Iteration.testCases, StructrualFragment.testCase],
]);

export const GENERATOR_ACTION_BY_ITERATION = new Map<
  Iteration,
  Extract<keyof Store, `generate${string}`>
>([
  [Iteration.productOverview, "generateProductOverview"],
  [Iteration.userStories, "generateUserStories"],
  [Iteration.requirements, "generateRequirements"],
  [Iteration.acceptanceCriteria, "generateAcceptanceCriteria"],
  [Iteration.testScenarios, "generateTestScenarios"],
  [Iteration.testCases, "generateTestCases"],
]);
export const ADD_ACTION_BY_STRUCTURAL_FRAGMENT = new Map<
  StructrualFragment,
  Extract<keyof Store, `add${string}`>
>([
  [StructrualFragment.userStory, "addUserStory"],
  [StructrualFragment.requirement, "addRequirement"],
  [StructrualFragment.acceptanceCriteria, "addAcceptanceCriteria"],
  [StructrualFragment.testScenario, "addTestScenario"],
]);
export const REMOVE_ACTION_BY_STRUCTURAL_FRAGMENT = new Map<
  StructrualFragment,
  Extract<keyof Store, `remove${string}`>
>([
  [StructrualFragment.userStory, "removeUserStory"],
  [StructrualFragment.requirement, "removeRequirement"],
  [StructrualFragment.acceptanceCriteria, "removeAcceptanceCriteria"],
  [StructrualFragment.testScenario, "removeTestScenario"],
]);

export function withSelf<
  Signature extends {
    [Key in string]: (...args: any) => any;
  }
>(
  object: Signature
): (self: IStateTreeNode) => {
  [Key in keyof Signature]: OmitFirstParameter<Signature[Key]>;
} {
  return (
    self: IStateTreeNode
  ): {
    [Key in keyof Signature]: OmitFirstParameter<Signature[Key]>;
  } => {
    const store = self as unknown as Store;

    return fromEntries(
      Object.keys(object).map((key) => [
        key,
        (...args: any) => object[key](store, ...args),
      ])
    );
  };
}
