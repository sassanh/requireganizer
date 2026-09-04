export enum WorkflowStage {
  ProductOverview = "product-overview",
  UserStories = "user-stories",
  Requirements = "requirements",
  AcceptanceCriteria = "acceptance-criteria",
  BoundaryDesign = "boundary-design",
  InterfaceContracts = "interface-contracts",
  TestScenarios = "test-scenarios",
  TestCases = "test-cases",
  ProjectSetup = "project-setup",
  AutomatedTests = "automated-tests",
  Code = "code",
}

export const WORKFLOW_STAGES = Object.values(WorkflowStage);
export const WORKFLOW_STAGE_LABELS: Record<WorkflowStage, string> = {
  [WorkflowStage.ProductOverview]: "Product Overview",
  [WorkflowStage.UserStories]: "User Stories",
  [WorkflowStage.Requirements]: "Requirements",
  [WorkflowStage.AcceptanceCriteria]: "Acceptance Criteria",
  [WorkflowStage.BoundaryDesign]: "Boundary Design",
  [WorkflowStage.InterfaceContracts]: "Interface Contracts",
  [WorkflowStage.TestScenarios]: "Test Scenarios",
  [WorkflowStage.TestCases]: "Test Cases",
  [WorkflowStage.ProjectSetup]: "Project Setup",
  [WorkflowStage.AutomatedTests]: "Automated Tests",
  [WorkflowStage.Code]: "Code",
};
export const LAST_WORKFLOW_STAGE = WorkflowStage.Code;

export function isBefore(left: WorkflowStage, right: WorkflowStage) {
  return WORKFLOW_STAGES.indexOf(left) < WORKFLOW_STAGES.indexOf(right);
}

export function isAfter(left: WorkflowStage, right: WorkflowStage) {
  return WORKFLOW_STAGES.indexOf(left) > WORKFLOW_STAGES.indexOf(right);
}

export enum StructuralFragment {
  PrimaryFeature = "primary_feature",
  TargetUser = "target_user",
  Requirement = "requirement",
  UserStory = "user_story",
  AcceptanceCriteria = "acceptance_criteria",
  TestScenario = "test_scenario",
  TestCase = "test_case",
  TestCode = "test_code",
}

export const STRUCTURAL_FRAGMENT_LABEL: Record<StructuralFragment, string> = {
  [StructuralFragment.PrimaryFeature]: "Primary Feature",
  [StructuralFragment.TargetUser]: "Target User",
  [StructuralFragment.Requirement]: "Requirement",
  [StructuralFragment.UserStory]: "User Story",
  [StructuralFragment.AcceptanceCriteria]: "Acceptance Criteria",
  [StructuralFragment.TestScenario]: "Test Scenario",
  [StructuralFragment.TestCase]: "Test Case",
  [StructuralFragment.TestCode]: "Automated Test",
};

export const WORKFLOW_STAGE_BY_STRUCTURAL_FRAGMENT: Record<StructuralFragment, WorkflowStage> = {
  [StructuralFragment.PrimaryFeature]: WorkflowStage.ProductOverview,
  [StructuralFragment.TargetUser]: WorkflowStage.ProductOverview,
  [StructuralFragment.Requirement]: WorkflowStage.Requirements,
  [StructuralFragment.UserStory]: WorkflowStage.UserStories,
  [StructuralFragment.AcceptanceCriteria]: WorkflowStage.AcceptanceCriteria,
  [StructuralFragment.TestScenario]: WorkflowStage.TestScenarios,
  [StructuralFragment.TestCase]: WorkflowStage.TestCases,
  [StructuralFragment.TestCode]: WorkflowStage.AutomatedTests,
};

export const STRUCTURAL_FRAGMENT_BY_WORKFLOW_STAGE: Partial<
  Record<WorkflowStage, StructuralFragment | StructuralFragment[]>
> = {
  [WorkflowStage.ProductOverview]: [StructuralFragment.PrimaryFeature, StructuralFragment.TargetUser],
  [WorkflowStage.Requirements]: StructuralFragment.Requirement,
  [WorkflowStage.UserStories]: StructuralFragment.UserStory,
  [WorkflowStage.AcceptanceCriteria]: StructuralFragment.AcceptanceCriteria,
  [WorkflowStage.TestScenarios]: StructuralFragment.TestScenario,
  [WorkflowStage.TestCases]: StructuralFragment.TestCase,
  [WorkflowStage.AutomatedTests]: StructuralFragment.TestCode,
};

export enum EngineerRole {
  RequirementsEngineer = "requirements-engineer",
  SoftwareTestEngineer = "software-test-engineer",
  SoftwareDeveloper = "software-developer",
}

export const ENGINEER_ROLE_LABELS: Record<EngineerRole, string> = {
  [EngineerRole.RequirementsEngineer]: "Requirements Engineer",
  [EngineerRole.SoftwareTestEngineer]: "Software Test Engineer",
  [EngineerRole.SoftwareDeveloper]: "Software Developer",
};

export const ENGINEER_ROLE_BY_WORKFLOW_STAGE: Record<WorkflowStage, EngineerRole[]> = {
  [WorkflowStage.ProductOverview]: [EngineerRole.RequirementsEngineer],
  [WorkflowStage.UserStories]: [EngineerRole.RequirementsEngineer],
  [WorkflowStage.Requirements]: [EngineerRole.RequirementsEngineer],
  [WorkflowStage.AcceptanceCriteria]: [EngineerRole.RequirementsEngineer, EngineerRole.SoftwareTestEngineer],
  [WorkflowStage.BoundaryDesign]: [EngineerRole.SoftwareDeveloper, EngineerRole.SoftwareTestEngineer],
  [WorkflowStage.InterfaceContracts]: [EngineerRole.SoftwareDeveloper, EngineerRole.SoftwareTestEngineer],
  [WorkflowStage.TestScenarios]: [EngineerRole.SoftwareTestEngineer],
  [WorkflowStage.TestCases]: [EngineerRole.SoftwareTestEngineer],
  [WorkflowStage.ProjectSetup]: [EngineerRole.SoftwareDeveloper],
  [WorkflowStage.AutomatedTests]: [EngineerRole.SoftwareDeveloper],
  [WorkflowStage.Code]: [EngineerRole.SoftwareDeveloper],
};

export type GeneratorActionName =
  | "generateProductOverview"
  | "generateUserStories"
  | "generateRequirements"
  | "generateAcceptanceCriteria"
  | "generateBoundaryDesign"
  | "generateImplementationProfile"
  | "generateInterfaceContracts"
  | "generateTestScenarios"
  | "generateTestCases"
  | "generateProjectSetup";

export const GENERATOR_ACTION_BY_WORKFLOW_STAGE: Record<WorkflowStage, GeneratorActionName | null> = {
  [WorkflowStage.ProductOverview]: "generateProductOverview",
  [WorkflowStage.UserStories]: "generateUserStories",
  [WorkflowStage.Requirements]: "generateRequirements",
  [WorkflowStage.AcceptanceCriteria]: "generateAcceptanceCriteria",
  [WorkflowStage.BoundaryDesign]: "generateBoundaryDesign",
  [WorkflowStage.InterfaceContracts]: "generateImplementationProfile",
  [WorkflowStage.TestScenarios]: "generateTestScenarios",
  [WorkflowStage.TestCases]: "generateTestCases",
  [WorkflowStage.ProjectSetup]: "generateProjectSetup",
  [WorkflowStage.AutomatedTests]: null,
  [WorkflowStage.Code]: null,
};

export const GENERATION_PREREQUISITE_BY_WORKFLOW_STAGE: Partial<Record<WorkflowStage, WorkflowStage>> = {
  [WorkflowStage.UserStories]: WorkflowStage.ProductOverview,
  [WorkflowStage.Requirements]: WorkflowStage.UserStories,
  [WorkflowStage.AcceptanceCriteria]: WorkflowStage.Requirements,
  [WorkflowStage.BoundaryDesign]: WorkflowStage.AcceptanceCriteria,
  [WorkflowStage.InterfaceContracts]: WorkflowStage.BoundaryDesign,
  [WorkflowStage.TestScenarios]: WorkflowStage.InterfaceContracts,
  [WorkflowStage.TestCases]: WorkflowStage.TestScenarios,
  [WorkflowStage.ProjectSetup]: WorkflowStage.TestCases,
  [WorkflowStage.AutomatedTests]: WorkflowStage.ProjectSetup,
};

/**
 * What the user can actually do about a stale stage. Contract suites
 * revise one exact target at a time by design, so they name targeted
 * revision; every other stage refreshes whole through the revise channel.
 */
export function refreshGuidance(step: WorkflowStage): string {
  if (step === WorkflowStage.InterfaceContracts) {
    return "Revise the affected contracts";
  }
  return `Refresh ${WORKFLOW_STAGE_LABELS[step]}`;
}

export const FRAGMENT_CODES: Record<StructuralFragment, string> = {
  [StructuralFragment.PrimaryFeature]: "FEA",
  [StructuralFragment.TargetUser]: "USR",
  [StructuralFragment.Requirement]: "REQ",
  [StructuralFragment.UserStory]: "US",
  [StructuralFragment.AcceptanceCriteria]: "AC",
  [StructuralFragment.TestScenario]: "TSC",
  [StructuralFragment.TestCase]: "TCS",
  [StructuralFragment.TestCode]: "TCD",
};

export enum Priority {
  P2 = "p2",
  P1 = "p1",
  P0 = "p0",
}

export enum Status {
  Pending = "pending",
  Completed = "completed",
  Outdated = "outdated",
  Locked = "locked",
}

export const OVERVIEW_NAME_QUALITY_ID = "productOverview/name";
export const OVERVIEW_PURPOSE_QUALITY_ID = "productOverview/purpose";
