"use client";

import EventEmitter from "events";

import { IMSTArray, Instance, SnapshotIn, cast, types } from "mobx-state-tree";
import { createContext, useContext } from "react";

import { EntityType } from "@/api/ai/lib";

import {
  export as export_,
  generateAcceptanceCriteria,
  generateProductOverview,
  generateRequirements,
  generateTestCases,
  generateTestScenarios,
  generateUserStories,
  handleComment,
  import as import_,
} from "./actions";
import {
  Framework,
  Iteration,
  LAST_ITERATION,
  PROGRAMMING_LANGUAGE_BY_FRAMEWORK,
  ProgrammingLanguage,
  isIterationBefore,
} from "./constants";
import {
  AcceptanceCriteria,
  AcceptanceCriteriaModel,
  Requirement,
  RequirementModel,
  StructuralFragmentModel,
  TestCaseModel,
  TestScenario,
  TestScenarioModel,
  UserStory,
  UserStoryModel,
} from "./models";
import { withSelf } from "./utilities";

class StoreEventEmitter extends EventEmitter {
  emitIterationUpdate(iteration: Iteration): void {
    this.emit("iterationUpdate", iteration);
  }
}

interface StoreEvents {
  iterationUpdate: (iteration: Iteration) => void;
}

declare interface StoreEventEmitter {
  once<U extends keyof StoreEvents>(event: U, listener: StoreEvents[U]): this;
  on<U extends keyof StoreEvents>(event: U, listener: StoreEvents[U]): this;
  off<U extends keyof StoreEvents>(event: U, listener: StoreEvents[U]): this;

  emit<U extends keyof StoreEvents>(
    event: U,
    ...args: Parameters<StoreEvents[U]>
  ): boolean;
}

export const FlatStore = types
  .model("Store", {
    isClean: types.optional(types.boolean, true),
    businessDepth: types.optional(types.number, 0),
    description: types.optional(types.string, ""),
    validationErrors: types.maybeNull(types.string),

    framework: types.maybeNull(types.enumeration(Object.values(Framework))),
    programmingLanguage: types.maybeNull(
      types.enumeration(Object.values(ProgrammingLanguage))
    ),

    productOverview: types.maybeNull(types.string),
    userStories: types.optional(types.array(UserStoryModel), [
      UserStoryModel.create({ content: "test" }),
    ]),
    requirements: types.array(RequirementModel),
    acceptanceCriteria: types.array(AcceptanceCriteriaModel),
    testScenarios: types.array(TestScenarioModel),
  })
  .actions((self) => ({
    reset() {
      self.isClean = true;
      self.businessDepth = 0;
      self.description = "";
      self.validationErrors = null;

      self.productOverview = null;
      self.userStories = cast([]);
      self.requirements = cast([]);
      self.acceptanceCriteria = cast([]);
      self.testScenarios = cast([]);
    },
    resetValidationErrors() {
      self.validationErrors = null;
    },
    setDescription(description: string) {
      self.description = description;
    },
    setValidationErrors(validationErrors: string) {
      self.validationErrors = validationErrors;
    },

    setFramework(framework: Framework | null) {
      self.framework = framework;
      if (framework != null)
        self.programmingLanguage =
          PROGRAMMING_LANGUAGE_BY_FRAMEWORK[framework].length === 1
            ? PROGRAMMING_LANGUAGE_BY_FRAMEWORK[framework][0]
            : null;
    },
    setProgrammingLanguage(programmingLanguage: ProgrammingLanguage) {
      self.programmingLanguage = programmingLanguage;
    },

    setProductOverview(productOverview: string) {
      self.productOverview = productOverview;
    },
    setUserStories(userStories: SnapshotIn<UserStory>[]) {
      self.isClean = false;
      self.userStories.clear();
      self.userStories = cast(userStories);
    },
    setRequirements(requirements: SnapshotIn<Requirement>[]) {
      self.isClean = false;
      self.requirements.clear();
      self.requirements = cast(requirements);
    },
    setAcceptanceCriteria(
      acceptanceCriteria: SnapshotIn<AcceptanceCriteria>[]
    ) {
      self.isClean = false;
      self.acceptanceCriteria.clear();
      self.acceptanceCriteria = cast(acceptanceCriteria);
    },
    setTestScenarios(testScenarios: SnapshotIn<TestScenario>[]) {
      self.isClean = false;
      self.testScenarios.clear();
      self.testScenarios = cast(testScenarios);
    },
    addUserStory() {
      self.isClean = false;
      self.userStories.push(
        UserStoryModel.create({ content: "New User Story" })
      );
    },
    addRequirement() {
      self.isClean = false;
      self.requirements.push(
        RequirementModel.create({ content: "New Requirement" })
      );
    },
    addAcceptanceCriteria() {
      self.isClean = false;
      self.acceptanceCriteria.push(
        AcceptanceCriteriaModel.create({ content: "New Acceptance Criteria" })
      );
    },
    addTestScenario() {
      self.isClean = false;
      self.testScenarios.push(
        TestScenarioModel.create({ content: "New Test Scenario" })
      );
    },
    removeUserStory(userStory: UserStory) {
      self.userStories.remove(userStory);
    },
    removeRequirement(requirement: Requirement) {
      self.requirements.remove(requirement);
    },
    removeAcceptanceCriteria(acceptanceCriteria: AcceptanceCriteria) {
      self.acceptanceCriteria.remove(acceptanceCriteria);
    },
    removeTestScenario(testScenario: TestScenario) {
      self.testScenarios.remove(testScenario);
    },
  }))
  .actions((self) => ({
    initialize({
      productOverview,
      framework,
      programmingLanguage,
    }: {
      productOverview: string;
      framework: Framework;
      programmingLanguage: ProgrammingLanguage;
    }) {
      self.setProductOverview(productOverview);
      self.setFramework(framework);
      self.setProgrammingLanguage(programmingLanguage);
    },
    updateList({
      entityType,
      parentId,
      insertions,
      removals,
      sort,
      modifications,
    }: {
      entityType: EntityType;
      parentId: string;
      insertions: { content: string; index?: number }[];
      removals: string[];
      sort: string[];
      modifications: { content: string; id: string }[];
    }) {
      var Model = {
        [EntityType.UserStory]: UserStoryModel,
        [EntityType.Requirement]: RequirementModel,
        [EntityType.AcceptanceCriteria]: AcceptanceCriteriaModel,
        [EntityType.TestScenario]: TestScenarioModel,
        [EntityType.TestCase]: TestCaseModel,
      }[entityType];

      var list_: IMSTArray<typeof StructuralFragmentModel> | undefined = {
        [EntityType.UserStory]: () => self.userStories,
        [EntityType.Requirement]: () => self.requirements,
        [EntityType.AcceptanceCriteria]: () => self.acceptanceCriteria,
        [EntityType.TestScenario]: () => self.testScenarios,
        [EntityType.TestCase]: (parentId_: string) =>
          self.testScenarios.find(({ id }) => id === parentId_)?.testCases,
      }[entityType](parentId);

      if (list_ != null) {
        const list = list_;
        if (sort.length > 0) {
          list.sort((a, b) => sort.indexOf(a.id) - sort.indexOf(b.id));
        }
        modifications.forEach(({ content, id }) => {
          const item = list.find(({ id: id_ }) => id === id_);
          item?.updateContent(content);
        });
        insertions.forEach(({ content, index }) =>
          list.splice(index ?? list.length, 0, Model.create({ content }))
        );
        removals.forEach((id) => {
          const item = list.find(({ id: id_ }) => id === id_);
          if (item != null) list.remove(item);
        });
      }
    },
    error({ description }: { description: string }) {
      console.error(description);
    },
  }))
  .views((self) => ({
    get isBusy() {
      return self.businessDepth > 0;
    },
    get testCases() {
      return self.testScenarios.flatMap(
        (testScenario) => testScenario.testCases
      );
    },
    data(iteration: Iteration = LAST_ITERATION) {
      return {
        ...(!isIterationBefore(iteration, Iteration.description)
          ? { description: self.description }
          : {}),
        ...(!isIterationBefore(iteration, Iteration.productOverview)
          ? {
            programmingLanguage: self.programmingLanguage,
            framework: self.framework,
            productOverview: self.productOverview,
          }
          : {}),
        ...(!isIterationBefore(iteration, Iteration.userStories)
          ? { userStories: self.userStories }
          : {}),
        ...(!isIterationBefore(iteration, Iteration.requirements)
          ? { requirements: self.requirements }
          : {}),
        ...(!isIterationBefore(iteration, Iteration.acceptanceCriteria)
          ? { acceptanceCriteria: self.acceptanceCriteria }
          : {}),
        ...(!isIterationBefore(iteration, Iteration.testScenarios)
          ? { testScenarios: self.testScenarios }
          : {}),
      };
    },
  }))
  .views((self) => ({
    json(iteration: Iteration = LAST_ITERATION) {
      return JSON.stringify(self.data(iteration));
    },
  }))
  .views(() => {
    const eventTarget = new StoreEventEmitter();

    return {
      get eventTarget() {
        return eventTarget;
      },
    };
  });

export const Store = FlatStore.actions(
  withSelf({
    handleComment,
    generateProductOverview,
    generateUserStories,
    generateRequirements,
    generateAcceptanceCriteria,
    generateTestScenarios,
    generateTestCases,
  })
).actions(withSelf({ import: import_, export: export_ }));

export type FlatStore = Instance<typeof FlatStore>;
export type Store = Instance<typeof Store>;
export const storeContext = createContext<Store>(null!);
export const useStore = () => useContext(storeContext);
