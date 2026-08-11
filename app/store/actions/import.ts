import { Store } from "store";
import {
  AcceptanceCriteria,
  Requirement,
  TestScenario,
  UserStory,
} from "store/models";
import { ProductOverview } from "store/models/ProductOverview";
import { hydrateMissingLastGeneratedAt } from "utilities/testParser";

const import_ = (
  self_: unknown,
  {
    description,
    productOverview,
    userStories,
    requirements,
    acceptanceCriteria,
    testScenarios,
    projectConfig,
    scaffoldFiles,
  }: {
    description: string;
    productOverview: ProductOverview;
    userStories: UserStory[];
    requirements: Requirement[];
    acceptanceCriteria: AcceptanceCriteria[];
    testScenarios: TestScenario[];
    projectConfig?: Record<string, unknown>;
    scaffoldFiles?: { path: string; content: string }[];
  },
) => {
  const self = self_ as Store;

  self.setDescription({ description });
  self.setProductOverview(productOverview);
  self.setUserStories({ userStories });
  self.setRequirements({ requirements });
  self.setAcceptanceCriteria({ acceptanceCriteria });
  self.setTestScenarios({ testScenarios });
  if (projectConfig) {
    self.setProjectConfig(JSON.stringify(projectConfig, null, 2));
    if (scaffoldFiles && scaffoldFiles.length > 0) {
      self.projectConfigLocked = true;
    }
  }
  if (scaffoldFiles && scaffoldFiles.length > 0) {
    self.setScaffoldFiles(scaffoldFiles);

    // Legacy Migration: Auto-hydrate missing lastGeneratedAt hooks for old test cases
    hydrateMissingLastGeneratedAt(
      self.testScenarios,
      Array.from(self.scaffoldFiles),
      productOverview?.programmingLanguage || "typescript",
    );
  }
};

export default import_;
