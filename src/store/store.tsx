import { pdf } from "@react-pdf/renderer";
import PDFDocument from "components/PDFDocument";
import { saveAs } from "file-saver";
import { Instance, SnapshotIn, cast, types } from "mobx-state-tree";
import { createContext, useContext } from "react";

import generateProductOverview from "./generation-actions/generateProductOverview";
import generateRequirements from "./generation-actions/generateRequirements";
import generateUserStories from "./generation-actions/generateUserStories";
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
import { withSelf } from "./utilities";

const Store = types
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

      self.productOverview = "";
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
    })
  )
  .actions((self) => ({
    import({
      userStories,
      requirements,
      acceptanceCriteria,
    }: {
      userStories: UserStory[];
      requirements: Requirement[];
      acceptanceCriteria: AcceptanceCriteria[];
    }) {
      self.setUserStories(userStories);
      self.setRequirements(requirements);
      self.setAcceptanceCriteria(acceptanceCriteria);
    },
    async export(format: "pdf" | "txt" | "json") {
      const filename = `specification.${format}`;

      if (format === "pdf") {
        const blob = await pdf(
          <PDFDocument
            userStories={self.userStories}
            requirements={self.requirements}
            acceptanceCriteria={self.acceptanceCriteria}
          />
        ).toBlob();
        saveAs(blob, filename);
      } else if (format === "txt" || format === "json") {
        let content = "";

        if (format === "txt") {
          content = `
User Stories:
${self.userStories.map((story) => story.content).join("\n")}

Requirements:
${self.requirements.map((req) => req.content).join("\n")}

Acceptance Criteria:
${self.acceptanceCriteria.map((criteria) => criteria.content).join("\n")}
      `;
        } else if (format === "json") {
          const data = {
            userStories: self.userStories,
            requirements: self.requirements,
            acceptanceCriteria: self.acceptanceCriteria,
          };
          content = JSON.stringify(data, null, 2);
        }

        const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
        saveAs(blob, filename);
      }
    },
  }));

// eslint-disable-next-line @typescript-eslint/no-redeclare
export type Store = Instance<typeof Store>;
export const storeContext = createContext<Store>(null!);
export const useStore = () => useContext(storeContext);
export default Store;
