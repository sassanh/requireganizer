import { WorkflowStage } from "store/constants";

/** Factory step that shows this change-focus subject, if any. */
export function stepForSubject(subject: string): WorkflowStage | null {
  const root = subject.split("/")[0];
  switch (root) {
    case "productOverview":
      return WorkflowStage.ProductOverview;
    case "userStories":
      return WorkflowStage.UserStories;
    case "requirements":
      return WorkflowStage.Requirements;
    case "acceptanceCriteria":
      return WorkflowStage.AcceptanceCriteria;
    case "boundaryDesign":
      return WorkflowStage.BoundaryDesign;
    case "implementationProfile":
    case "contractSuite":
      return WorkflowStage.InterfaceContracts;
    case "testScenarios":
      return subject.includes("/testCases")
        ? WorkflowStage.TestCases
        : WorkflowStage.TestScenarios;
    case "testCases":
      return WorkflowStage.TestCases;
    case "projectSetup":
    case "scaffoldFiles":
      return WorkflowStage.ProjectSetup;
    default:
      return null;
  }
}
