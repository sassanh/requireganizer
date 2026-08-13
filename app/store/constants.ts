export enum Step {
  Description = "description",
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

export const STEPS = Object.values(Step);
export const STEP_LABELS: Record<Step, string> = {
  [Step.Description]: "Description",
  [Step.ProductOverview]: "Product Overview",
  [Step.UserStories]: "User Stories",
  [Step.Requirements]: "Requirements",
  [Step.AcceptanceCriteria]: "Acceptance Criteria",
  [Step.BoundaryDesign]: "Boundary Design",
  [Step.InterfaceContracts]: "Interface Contracts",
  [Step.TestScenarios]: "Test Scenarios",
  [Step.TestCases]: "Test Cases",
  [Step.ProjectSetup]: "Project Setup",
  [Step.AutomatedTests]: "Automated Tests",
  [Step.Code]: "Code",
};
export const LAST_STEP = Step.Code;

export function isBefore(left: Step, right: Step) {
  return STEPS.indexOf(left) < STEPS.indexOf(right);
}

export function isAfter(left: Step, right: Step) {
  return STEPS.indexOf(left) > STEPS.indexOf(right);
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

export const STEP_BY_STRUCTURAL_FRAGMENT: Record<StructuralFragment, Step> = {
  [StructuralFragment.PrimaryFeature]: Step.ProductOverview,
  [StructuralFragment.TargetUser]: Step.ProductOverview,
  [StructuralFragment.Requirement]: Step.Requirements,
  [StructuralFragment.UserStory]: Step.UserStories,
  [StructuralFragment.AcceptanceCriteria]: Step.AcceptanceCriteria,
  [StructuralFragment.TestScenario]: Step.TestScenarios,
  [StructuralFragment.TestCase]: Step.TestCases,
  [StructuralFragment.TestCode]: Step.AutomatedTests,
};

export const STRUCTURAL_FRAGMENT_BY_STEP: Partial<
  Record<Step, StructuralFragment | StructuralFragment[]>
> = {
  [Step.ProductOverview]: [StructuralFragment.PrimaryFeature, StructuralFragment.TargetUser],
  [Step.Requirements]: StructuralFragment.Requirement,
  [Step.UserStories]: StructuralFragment.UserStory,
  [Step.AcceptanceCriteria]: StructuralFragment.AcceptanceCriteria,
  [Step.TestScenarios]: StructuralFragment.TestScenario,
  [Step.TestCases]: StructuralFragment.TestCase,
  [Step.AutomatedTests]: StructuralFragment.TestCode,
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

export const ENGINEER_ROLE_BY_STEP: Record<Step, EngineerRole[]> = {
  [Step.Description]: [EngineerRole.RequirementsEngineer],
  [Step.ProductOverview]: [EngineerRole.RequirementsEngineer],
  [Step.UserStories]: [EngineerRole.RequirementsEngineer],
  [Step.Requirements]: [EngineerRole.RequirementsEngineer],
  [Step.AcceptanceCriteria]: [EngineerRole.RequirementsEngineer, EngineerRole.SoftwareTestEngineer],
  [Step.BoundaryDesign]: [EngineerRole.SoftwareDeveloper, EngineerRole.SoftwareTestEngineer],
  [Step.InterfaceContracts]: [EngineerRole.SoftwareDeveloper, EngineerRole.SoftwareTestEngineer],
  [Step.TestScenarios]: [EngineerRole.SoftwareTestEngineer],
  [Step.TestCases]: [EngineerRole.SoftwareTestEngineer],
  [Step.ProjectSetup]: [EngineerRole.SoftwareDeveloper],
  [Step.AutomatedTests]: [EngineerRole.SoftwareDeveloper],
  [Step.Code]: [EngineerRole.SoftwareDeveloper],
};

export type GeneratorActionName =
  | "generateProductOverview"
  | "generateUserStories"
  | "generateRequirements"
  | "generateAcceptanceCriteria"
  | "generateBoundaryDesign"
  | "generateImplementationProfile"
  | "generateTestScenarios"
  | "generateTestCases"
  | "generateProjectSetup";

export const GENERATOR_ACTION_BY_STEP: Record<Step, GeneratorActionName | null> = {
  [Step.Description]: null,
  [Step.ProductOverview]: "generateProductOverview",
  [Step.UserStories]: "generateUserStories",
  [Step.Requirements]: "generateRequirements",
  [Step.AcceptanceCriteria]: "generateAcceptanceCriteria",
  [Step.BoundaryDesign]: "generateBoundaryDesign",
  [Step.InterfaceContracts]: "generateImplementationProfile",
  [Step.TestScenarios]: "generateTestScenarios",
  [Step.TestCases]: "generateTestCases",
  [Step.ProjectSetup]: "generateProjectSetup",
  [Step.AutomatedTests]: null,
  [Step.Code]: null,
};

export const GENERATION_PREREQUISITE_BY_STEP: Partial<Record<Step, Step>> = {
  [Step.ProductOverview]: Step.Description,
  [Step.UserStories]: Step.ProductOverview,
  [Step.Requirements]: Step.UserStories,
  [Step.AcceptanceCriteria]: Step.Requirements,
  [Step.BoundaryDesign]: Step.AcceptanceCriteria,
  [Step.InterfaceContracts]: Step.BoundaryDesign,
  [Step.TestScenarios]: Step.InterfaceContracts,
  [Step.TestCases]: Step.TestScenarios,
  [Step.ProjectSetup]: Step.TestCases,
  [Step.AutomatedTests]: Step.ProjectSetup,
};

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
}
