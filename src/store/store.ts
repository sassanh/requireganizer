import EventEmitter from "events";

import { Instance, SnapshotIn, cast, types } from "mobx-state-tree";
import { createContext, useContext } from "react";

import {
  export as export_,
  generateAcceptanceCriteria,
  generateProductOverview,
  generateRequirements,
  generateTestScenarios,
  generateUserStories,
  import as import_,
} from "./actions";
import {
  AcceptanceCriteria,
  AcceptanceCriteriaModel,
  Requirement,
  RequirementModel,
  TestScenario,
  TestScenarioModel,
  UserStory,
  UserStoryModel,
} from "./models";
import { Iteration, withSelf } from "./utilities";

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

export const Store = types
  .model("Store", {
    isClean: types.optional(types.boolean, true),
    isGenerating: types.optional(types.boolean, false),
    description: types.optional(types.string, ""),
    validationErrors: types.maybeNull(types.string),

    productOverview: types.maybeNull(types.string),
    userStories: types.array(UserStoryModel),
    requirements: types.array(RequirementModel),
    acceptanceCriteria: types.array(AcceptanceCriteriaModel),
    testScenarios: types.array(TestScenarioModel),
  })
  .actions((self) => ({
    reset() {
      self.isClean = true;
      self.isGenerating = false;
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

    setProductOverview(productOverview: string) {
      self.productOverview = productOverview;
    },
    setUserStories(userStories: SnapshotIn<UserStory>[]) {
      self.isClean = false;
      self.userStories.push(
        ...userStories.map((item) => UserStoryModel.create(item))
      );
    },
    setRequirements(requirements: SnapshotIn<Requirement>[]) {
      self.isClean = false;
      self.requirements.push(
        ...requirements.map((item) => RequirementModel.create(item))
      );
    },
    setAcceptanceCriteria(
      acceptanceCriteria: SnapshotIn<AcceptanceCriteria>[]
    ) {
      self.isClean = false;
      self.acceptanceCriteria.push(
        ...acceptanceCriteria.map((item) =>
          AcceptanceCriteriaModel.create(item)
        )
      );
    },
    setTestScenarios(testScenarios: SnapshotIn<TestScenario>[]) {
      self.isClean = false;
      self.testScenarios.push(
        ...testScenarios.map((item) => TestScenarioModel.create(item))
      );
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
  .actions(
    withSelf({
      generateProductOverview,
      generateUserStories,
      generateRequirements,
      generateAcceptanceCriteria,
      generateTestScenarios,
    })
  )
  .actions(withSelf({ import: import_, export: export_ }))
  .views(() => {
    const eventTarget = new StoreEventEmitter();

    return {
      get eventTarget() {
        return eventTarget;
      },
    };
  });

// eslint-disable-next-line @typescript-eslint/no-redeclare
export type Store = Instance<typeof Store>;
export const storeContext = createContext<Store>(null!);
export const useStore = () => useContext(storeContext);
