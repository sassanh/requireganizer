import {
  EngineerRole,
  Step,
  StructuralFragment,
} from "store/constants";

export interface ArtifactStageDefinition {
  step: Step;
  entityType: StructuralFragment;
  role: EngineerRole;
  requiredStoreFields: readonly string[];
  allowedReferenceTypes: readonly StructuralFragment[];
  coverageReferenceType: StructuralFragment | null;
  objective: string;
  itemContract: string;
  qualityRules: readonly string[];
}

export const CANONICAL_WORKFLOW: readonly Step[] = [
  Step.Description,
  Step.ProductOverview,
  Step.UserStories,
  Step.Requirements,
  Step.AcceptanceCriteria,
  Step.TestScenarios,
  Step.TestCases,
  Step.TestCode,
  Step.Code,
];

export const WORKFLOW_SUMMARY = CANONICAL_WORKFLOW.map(
  (step, index) => `${index + 1}. ${step}`,
).join("\n");

export const ARTIFACT_STAGE_DEFINITIONS: Record<
  | StructuralFragment.UserStory
  | StructuralFragment.Requirement
  | StructuralFragment.AcceptanceCriteria
  | StructuralFragment.TestScenario
  | StructuralFragment.TestCase,
  ArtifactStageDefinition
> = {
  [StructuralFragment.UserStory]: {
    step: Step.UserStories,
    entityType: StructuralFragment.UserStory,
    role: EngineerRole.RequirementsEngineer,
    requiredStoreFields: ["description", "productOverview"],
    allowedReferenceTypes: [
      StructuralFragment.PrimaryFeature,
      StructuralFragment.TargetUser,
    ],
    coverageReferenceType: StructuralFragment.PrimaryFeature,
    objective:
      "Describe independently valuable user outcomes before specifying implementation-facing requirements.",
    itemContract:
      'content uses "As a <specific user>, I want <testable outcome>, so that <objective value>".',
    qualityRules: [
      "Cover every primary feature with at least one story.",
      "Keep each story independently understandable and small enough to validate.",
      "Do not use vague qualities such as intuitive, seamless, or user-friendly.",
      "Reference only relevant primary features or target users from the supplied context.",
    ],
  },
  [StructuralFragment.Requirement]: {
    step: Step.Requirements,
    entityType: StructuralFragment.Requirement,
    role: EngineerRole.RequirementsEngineer,
    requiredStoreFields: ["description", "productOverview", "userStories"],
    allowedReferenceTypes: [
      StructuralFragment.UserStory,
      StructuralFragment.PrimaryFeature,
    ],
    coverageReferenceType: StructuralFragment.UserStory,
    objective:
      "Translate approved user outcomes into precise, solution-neutral, verifiable system obligations.",
    itemContract:
      'content is one atomic statement using "The system must ..." and includes measurable bounds where relevant.',
    qualityRules: [
      "Cover every user story with at least one requirement.",
      "Keep one independently verifiable obligation per item.",
      "Avoid implementation details unless the project description explicitly mandates them.",
      "Use dependencies only for genuine ordering or technical prerequisites within this requirement list.",
    ],
  },
  [StructuralFragment.AcceptanceCriteria]: {
    step: Step.AcceptanceCriteria,
    entityType: StructuralFragment.AcceptanceCriteria,
    role: EngineerRole.SoftwareTestEngineer,
    requiredStoreFields: [
      "description",
      "productOverview",
      "userStories",
      "requirements",
    ],
    allowedReferenceTypes: [
      StructuralFragment.UserStory,
      StructuralFragment.Requirement,
    ],
    coverageReferenceType: StructuralFragment.Requirement,
    objective:
      "Define observable pass/fail conditions that prove stories and requirements are satisfied.",
    itemContract:
      "content states a concrete precondition or event and one observable expected outcome.",
    qualityRules: [
      "Every requirement must be covered by at least one criterion.",
      "Use measurable, binary outcomes and include boundary conditions where relevant.",
      "Do not describe implementation techniques.",
      "Reference the exact requirements and stories that the criterion verifies.",
    ],
  },
  [StructuralFragment.TestScenario]: {
    step: Step.TestScenarios,
    entityType: StructuralFragment.TestScenario,
    role: EngineerRole.SoftwareTestEngineer,
    requiredStoreFields: [
      "description",
      "productOverview",
      "userStories",
      "requirements",
      "acceptanceCriteria",
    ],
    allowedReferenceTypes: [StructuralFragment.AcceptanceCriteria],
    coverageReferenceType: StructuralFragment.AcceptanceCriteria,
    objective:
      "Organize acceptance coverage into high-level executable-test situations without writing test steps yet.",
    itemContract:
      "content is a concise scenario title describing the behavior and condition under test.",
    qualityRules: [
      "Cover every acceptance criterion.",
      "Include normal, boundary, and meaningful failure scenarios.",
      "Do not include detailed steps or expected results at this stage.",
      "Reference only the acceptance criteria exercised by the scenario.",
    ],
  },
  [StructuralFragment.TestCase]: {
    step: Step.TestCases,
    entityType: StructuralFragment.TestCase,
    role: EngineerRole.SoftwareTestEngineer,
    requiredStoreFields: [
      "description",
      "productOverview",
      "userStories",
      "requirements",
      "acceptanceCriteria",
      "testScenarios",
    ],
    allowedReferenceTypes: [
      StructuralFragment.TestScenario,
      StructuralFragment.AcceptanceCriteria,
      StructuralFragment.Requirement,
    ],
    coverageReferenceType: null,
    objective:
      "Produce focused, reproducible test cases for exactly one parent scenario.",
    itemContract:
      "title is concise; steps are numbered and reproducible; expectedResult is precise and observable; content is omitted.",
    qualityRules: [
      "Each case validates one behavior or boundary.",
      "Use concrete inputs whenever the scenario permits them.",
      "Do not broaden coverage beyond the parent scenario.",
      "Include enough information for deterministic automated-test generation.",
    ],
  },
};

export function getArtifactStageDefinition(
  entityType: StructuralFragment,
): ArtifactStageDefinition {
  if (
    entityType === StructuralFragment.PrimaryFeature ||
    entityType === StructuralFragment.TargetUser ||
    entityType === StructuralFragment.TestCode
  ) {
    throw new Error(`${entityType} is not generated by an artifact-list stage.`);
  }

  return ARTIFACT_STAGE_DEFINITIONS[entityType];
}
