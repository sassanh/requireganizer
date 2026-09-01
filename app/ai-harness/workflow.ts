import {
  EngineerRole,
  WorkflowStage,
  StructuralFragment,
  WORKFLOW_STAGE_BY_STRUCTURAL_FRAGMENT,
} from "store/constants";

export interface QualityContract {
  objective: string;
  itemContract: string;
  qualityRules: readonly string[];
}

export interface ArtifactStageDefinition {
  step: WorkflowStage;
  entityType: StructuralFragment;
  role: EngineerRole;
  requiredStoreFields: readonly string[];
  allowedReferenceTypes: readonly StructuralFragment[];
  coverageReferenceType: StructuralFragment | null;
}

export const CANONICAL_WORKFLOW: readonly WorkflowStage[] = [
  WorkflowStage.ProductOverview,
  WorkflowStage.UserStories,
  WorkflowStage.Requirements,
  WorkflowStage.AcceptanceCriteria,
  WorkflowStage.BoundaryDesign,
  WorkflowStage.InterfaceContracts,
  WorkflowStage.TestScenarios,
  WorkflowStage.TestCases,
  WorkflowStage.ProjectSetup,
  WorkflowStage.AutomatedTests,
  WorkflowStage.Code,
];

export const WORKFLOW_SUMMARY = CANONICAL_WORKFLOW.map(
  (step, index) => `${index + 1}. ${step}`,
).join("\n");

export const ARTIFACT_STAGE_DEFINITIONS: Record<
  | StructuralFragment.UserStory
  | StructuralFragment.Requirement
  | StructuralFragment.AcceptanceCriteria,
  ArtifactStageDefinition
> = {
  [StructuralFragment.UserStory]: {
    step: WorkflowStage.UserStories,
    entityType: StructuralFragment.UserStory,
    role: EngineerRole.RequirementsEngineer,
    requiredStoreFields: ["productOverview"],
    allowedReferenceTypes: [
      StructuralFragment.PrimaryFeature,
      StructuralFragment.TargetUser,
    ],
    coverageReferenceType: StructuralFragment.PrimaryFeature,
  },
  [StructuralFragment.Requirement]: {
    step: WorkflowStage.Requirements,
    entityType: StructuralFragment.Requirement,
    role: EngineerRole.RequirementsEngineer,
    requiredStoreFields: ["productOverview", "userStories"],
    allowedReferenceTypes: [
      StructuralFragment.UserStory,
      StructuralFragment.PrimaryFeature,
    ],
    coverageReferenceType: StructuralFragment.UserStory,
  },
  [StructuralFragment.AcceptanceCriteria]: {
    step: WorkflowStage.AcceptanceCriteria,
    entityType: StructuralFragment.AcceptanceCriteria,
    role: EngineerRole.SoftwareTestEngineer,
    requiredStoreFields: [
      "productOverview",
      "userStories",
      "requirements",
    ],
    allowedReferenceTypes: [
      StructuralFragment.UserStory,
      StructuralFragment.Requirement,
    ],
    coverageReferenceType: StructuralFragment.Requirement,
  },
};

export const STAGE_QUALITY_CONTRACTS: {
  readonly [WorkflowStage.ProductOverview]: QualityContract;
  readonly [WorkflowStage.UserStories]: QualityContract;
  readonly [WorkflowStage.Requirements]: QualityContract;
  readonly [WorkflowStage.AcceptanceCriteria]: QualityContract;
} = {
  [WorkflowStage.ProductOverview]: {
    objective:
      "Describe the product as outcomes for people, without choosing an implementation.",
    itemContract:
      "The overview has a product name, an outcome-oriented purpose, primary features as user-facing capabilities, and target users as the people who receive those outcomes. It must not choose technology, architecture, or implementation.",
    qualityRules: [
      "Purpose states who is helped and what changes for them, not how the software is built.",
      "Each primary feature is a capability a user would recognize, not a module, API, or stack choice.",
      "Each target user is a kind of person or role, not a technical actor unless the product is for that actor.",
      "Do not introduce implementation choices unless the user has already mandated them.",
    ],
  },
  [WorkflowStage.UserStories]: {
    objective:
      "Describe independently valuable user outcomes before specifying implementation-facing requirements.",
    itemContract:
      'content uses "As a <specific user>, I want <testable outcome>, so that <objective value>".',
    qualityRules: [
      "Cover every primary feature with at least one story.",
      "Keep each story independently understandable and small enough to validate.",
      "Do not substitute untestable quality claims for a testable outcome (for example, a story whose only outcome is that the product feels intuitive). Domain language is allowed when it names the product's subject.",
      "Reference only relevant primary features or target users from the supplied context.",
    ],
  },
  [WorkflowStage.Requirements]: {
    objective:
      "Translate approved user outcomes into precise, solution-neutral, verifiable system obligations.",
    itemContract:
      'content is one atomic statement using "The system must ..." and includes measurable bounds where relevant.',
    qualityRules: [
      "Cover every user story with at least one requirement.",
      "Keep one independently verifiable obligation per item.",
      "Avoid implementation details unless the product overview explicitly mandates them.",
      "Use dependencies only for genuine ordering or technical prerequisites within this requirement list.",
    ],
  },
  [WorkflowStage.AcceptanceCriteria]: {
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
};

export function qualityContractForStage(stage: WorkflowStage): QualityContract | null {
  switch (stage) {
    case WorkflowStage.ProductOverview:
    case WorkflowStage.UserStories:
    case WorkflowStage.Requirements:
    case WorkflowStage.AcceptanceCriteria:
      return STAGE_QUALITY_CONTRACTS[stage];
    default:
      return null;
  }
}

export function qualityContractForFragment(
  entityType: StructuralFragment,
): QualityContract | null {
  return qualityContractForStage(WORKFLOW_STAGE_BY_STRUCTURAL_FRAGMENT[entityType]);
}

/**
 * The only reader of quality-contract fields. Submit-tool descriptions
 * attach this text so the model verifies writing; code does not parse it.
 */
export function formatQualityContract(contract: QualityContract): string {
  const rules = contract.qualityRules.map((rule) => `- ${rule}`).join("\n");
  return [
    `Objective: ${contract.objective}`,
    `Contract: ${contract.itemContract}`,
    "Rules:",
    rules,
    "Verify the writing against this contract before submitting. Do not submit text that fails it. Judge the claim, not the vocabulary.",
  ].join("\n");
}

export function withQualityContract(
  baseDescription: string,
  contract: QualityContract | null,
): string {
  if (contract == null) return baseDescription;
  return `${baseDescription}\n\n${formatQualityContract(contract)}`;
}

export function getArtifactStageDefinition(
  entityType: StructuralFragment,
): ArtifactStageDefinition {
  if (
    entityType === StructuralFragment.PrimaryFeature ||
    entityType === StructuralFragment.TargetUser ||
    entityType === StructuralFragment.TestScenario ||
    entityType === StructuralFragment.TestCase ||
    entityType === StructuralFragment.TestCode
  ) {
    throw new Error(`${entityType} is not generated by an artifact-list stage.`);
  }

  return ARTIFACT_STAGE_DEFINITIONS[entityType];
}
