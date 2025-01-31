import { Store } from "store";
import {
  AcceptanceCriteria,
  Requirement,
  TestScenario,
  UserStory,
} from "store/models";
import { ProductOverview } from "store/models/ProductOverview";

const import_ = (
  self_: unknown,
  {
    description,
    productOverview,
    userStories,
    requirements,
    acceptanceCriteria,
    testScenarios,
  }: {
    description: string;
    productOverview: ProductOverview;
    userStories: UserStory[];
    requirements: Requirement[];
    acceptanceCriteria: AcceptanceCriteria[];
    testScenarios: TestScenario[];
  },
) => {
  const self = self_ as Store;

  self.setDescription({ description });
  self.setProductOverview(productOverview);
  self.setUserStories({ userStories });
  self.setRequirements({ requirements });
  self.setAcceptanceCriteria({ acceptanceCriteria });
  self.setTestScenarios({ testScenarios });
};

export default import_;
