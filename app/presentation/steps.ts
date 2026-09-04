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

/**
 * Subjects no element presents: workflow bookkeeping the queue must not
 * play. Such frames could never be claimed; they would only tax the queue
 * and steal the rush boundaries from the visible items around them.
 */
export function isPresentableSubject(subject: string): boolean {
  return (
    subject !== "stageInputFingerprints" &&
    !subject.startsWith("stageInputFingerprints/")
  );
}
