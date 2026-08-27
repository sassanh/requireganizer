import { Step } from "store/constants";

/** Factory step that shows this change-focus subject, if any. */
export function stepForSubject(subject: string): Step | null {
  const root = subject.split("/")[0];
  switch (root) {
    case "description":
      return Step.Description;
    case "productOverview":
      return Step.ProductOverview;
    case "userStories":
      return Step.UserStories;
    case "requirements":
      return Step.Requirements;
    case "acceptanceCriteria":
      return Step.AcceptanceCriteria;
    case "boundaryDesign":
      return Step.BoundaryDesign;
    case "implementationProfile":
    case "contractSuite":
      return Step.InterfaceContracts;
    case "testScenarios":
      return subject.includes("/testCases")
        ? Step.TestCases
        : Step.TestScenarios;
    case "testCases":
      return Step.TestCases;
    case "projectSetup":
    case "scaffoldFiles":
      return Step.ProjectSetup;
    default:
      return null;
  }
}
