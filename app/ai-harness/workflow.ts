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

/**
 * What a reviewable unit is judged against. Prose stages and formal
 * artifacts each have one; a coverage or impact approval has its own.
 */
export type ReviewSubject =
  | WorkflowStage.ProductOverview
  | WorkflowStage.UserStories
  | WorkflowStage.Requirements
  | WorkflowStage.AcceptanceCriteria
  | WorkflowStage.BoundaryDesign
  | WorkflowStage.TestScenarios
  | WorkflowStage.TestCases
  | WorkflowStage.ProjectSetup
  | "implementation-profile"
  | "interface-contract"
  | "subject-contract"
  | "verification-contract"
  | "coverage"
  | "impact";

export const QUALITY_CONTRACTS: Readonly<Record<ReviewSubject, QualityContract>> = {
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
  [WorkflowStage.BoundaryDesign]: {
    objective:
      "Partition the product into test subjects with observable interfaces so every acceptance criterion is verifiable.",
    itemContract:
      "The graph has a root product subject, internal subjects only where a requirement or criterion justifies them, interfaces with their peer and direction, interactions with observable input, output, failures, and state effects, and for every criterion a behavioral interaction or verification obligation.",
    qualityRules: [
      "Each interaction describes behavior observable at its interface, never implementation syntax.",
      "Each subject states what it owns and what it excludes.",
      "Coverage maps each criterion to the interaction or obligation that actually verifies it.",
      "Introduce no subject, interface, or interaction that no requirement or criterion needs.",
    ],
  },
  "implementation-profile": {
    objective:
      "Record the platform and toolchain the contracts, scaffold, and tests target, without defining product behavior.",
    itemContract:
      "Platform, runtime, language, framework, module system, build ecosystem, test ecosystem, and constraints are concrete and compatible with each other.",
    qualityRules: [
      "Choose versions and tools that work together.",
      "Do not restate requirements as constraints.",
      "Name only what contracts, scaffold, and tests depend on.",
    ],
  },
  "interface-contract": {
    objective: "Formalize one interface so tests can drive and observe it exactly.",
    itemContract:
      "Every interaction of the interface maps to one operation with input, output, and error schemas, and the native or neutral contract matches the normalized index.",
    qualityRules: [
      "Schemas are exactly as strict as the interaction's semantics.",
      "Every declared outcome follows from the interaction's description.",
      "Adapter instructions are specific enough to revise the contract without guessing.",
    ],
  },
  "subject-contract": {
    objective: "Define how a fresh subject is obtained, driven, and observed across its interfaces.",
    itemContract:
      "The protocol states initial state, states, transitions, and ordering rules; the harness binding says how to create and reset the subject and binds every owned interaction.",
    qualityRules: [
      "Transitions follow from the interactions' state effects.",
      "Every owned interaction has exactly one invocation and observation binding.",
      "The harness binding adds no product behavior.",
    ],
  },
  "verification-contract": {
    objective: "Make one non-behavioral obligation checkable from collected evidence.",
    itemContract:
      "Environment, stimulus, evidence schema, and pass matchers decide pass or fail without a judgment call.",
    qualityRules: [
      "Pass matchers test the obligation's measurable bound.",
      "The evidence schema captures everything the matchers read.",
    ],
  },
  [WorkflowStage.TestScenarios]: {
    objective:
      "Choose the situations that together exercise every acceptance criterion through the approved contracts.",
    itemContract:
      "Each scenario names one situation, binds one subject's interfaces or one verification obligation, and claims the criteria it exercises.",
    qualityRules: [
      "Claim a criterion only when the scenario actually exercises it.",
      "No two scenarios exercise the same situation.",
      "Describe the situation, not the steps.",
    ],
  },
  [WorkflowStage.TestCases]: {
    objective: "Turn one scenario into exact traces or verification plans.",
    itemContract:
      "Each case has one initial fixture and an ordered trace whose inputs and expected observations follow the bound contracts.",
    qualityRules: [
      "Expected observations follow from the contracts and the claimed criteria, never from guesses about the implementation.",
      "Cover the boundary conditions the claimed criteria name.",
      "The title and description say what the case proves.",
    ],
  },
  [WorkflowStage.ProjectSetup]: {
    objective:
      "Produce a buildable scaffold that carries the approved contracts and leaves product behavior unimplemented.",
    itemContract:
      "Configuration, manifest, and files agree with the implementation profile and place every contract document unchanged.",
    qualityRules: [
      "Build and test commands match the profile's ecosystems.",
      "Binding seams stay unimplemented.",
      "Add no file the build or tests do not need.",
    ],
  },
  coverage: {
    objective: "Confirm that nothing is missing under one upstream item.",
    itemContract: "The items referencing the upstream item together cover everything it states.",
    qualityRules: [
      "Name the specific part of the upstream item that no referencing item covers.",
      "Judge completeness, not the writing of each item.",
    ],
  },
  impact: {
    objective: "Confirm that an upstream change leaves the listed items correct.",
    itemContract: "Every listed item still holds under the changed inputs.",
    qualityRules: [
      "Name each item the change affects and how.",
      "An item that references none of the changed inputs can still depend on them.",
    ],
  },
};

/** The contract a stage's writer checks before submitting; Interface Contracts submits several kinds. */
export function qualityContractForStage(stage: WorkflowStage): QualityContract | null {
  switch (stage) {
    case WorkflowStage.ProductOverview:
    case WorkflowStage.UserStories:
    case WorkflowStage.Requirements:
    case WorkflowStage.AcceptanceCriteria:
    case WorkflowStage.BoundaryDesign:
    case WorkflowStage.TestScenarios:
    case WorkflowStage.TestCases:
    case WorkflowStage.ProjectSetup:
      return QUALITY_CONTRACTS[stage];
    default:
      return null;
  }
}

/** Every contract the formal-contract suite writer submits against, in one description. */
export function contractSuiteQualityContracts(): QualityContract[] {
  return [
    QUALITY_CONTRACTS["interface-contract"],
    QUALITY_CONTRACTS["subject-contract"],
    QUALITY_CONTRACTS["verification-contract"],
  ];
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
export function formatQualityContract(
  contract: QualityContract,
  mode: "submit" | "check" = "submit",
): string {
  const rules = contract.qualityRules.map((rule) => `- ${rule}`).join("\n");
  const action =
    mode === "check"
      ? "Judge each item against this contract. Report good or bad. Do not rewrite. Judge the claim, not the vocabulary."
      : "Verify the writing against this contract before submitting. Do not submit text that fails it. Judge the claim, not the vocabulary.";
  return [
    `Objective: ${contract.objective}`,
    `Contract: ${contract.itemContract}`,
    "Rules:",
    rules,
    action,
  ].join("\n");
}

export function withQualityContract(
  baseDescription: string,
  contract: QualityContract | null,
  mode: "submit" | "check" = "submit",
): string {
  if (contract == null) return baseDescription;
  return `${baseDescription}\n\n${formatQualityContract(contract, mode)}`;
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
