import { Framework, ProgrammingLanguage, Store } from "store";
import {
  AcceptanceCriteria,
  Requirement,
  TestScenario,
  UserStory,
} from "store/models";

const import_ = (
  self_: unknown,
  {
    programmingLanguage,
    framework,
    description,
    productOverview,
    userStories,
    requirements,
    acceptanceCriteria,
    testScenarios,
  }: {
    programmingLanguage: ProgrammingLanguage;
    framework: Framework;
    description: string;
    productOverview: string;
    userStories: UserStory[];
    requirements: Requirement[];
    acceptanceCriteria: AcceptanceCriteria[];
    testScenarios: TestScenario[];
  },
) => {
  const self = self_ as Store;
  self.setProgrammingLanguage({ programmingLanguage });
  self.setFramework({ framework });

  self.setDescription({ description });
  self.setProductOverview({ productOverview });
  self.setUserStories({ userStories });
  self.setRequirements({ requirements });
  self.setAcceptanceCriteria({ acceptanceCriteria });
  self.setTestScenarios({ testScenarios });
};

export default import_;
