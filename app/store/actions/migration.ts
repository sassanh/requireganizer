import {
  canonicalJson,
  fingerprint,
  sha256Text,
  type JsonValue,
} from "contract-domain";
import { isRecord } from "lib/json";
import { LEGACY_MODULE_SCHEMA_VERSION, MODULE_SCHEMA_VERSION } from "lib/projectSchema";
import {
  OVERVIEW_PURPOSE_QUALITY_ID,
  StructuralFragment,
  WorkflowStage,
} from "store/constants";
import type { StructuralFragment as StructuralFragmentInstance } from "store/models";
import {
  EMPTY_REVIEW_BOOK,
  PERSON,
  STAGE_INPUTS,
  approvalRecord,
  checkedHash,
  itemSetRevision,
  proseRevision,
} from "store/review";
import type { FlatStore } from "store/store";

/**
 * What a schema 3 module said about review that schema 5 records
 * differently. Carried from the JSON transform to the store pass that can
 * compute checked hashes.
 */
export interface LegacyReview {
  approvedIds: string[];
  /** The last approved text of a draft that had been rewritten. */
  signedTexts: Record<string, string>;
  /** Stages the schema 3 workflow showed as outdated. */
  outdatedStages: WorkflowStage[];
  boundaryWasCurrent: boolean;
}

type Snapshot = Record<string, unknown>;

// ---------------------------------------------------------------------
// The schema 3 stage input hash, ported verbatim: a recorded fingerprint
// differing from it is exactly what schema 3 showed as an outdated stage.
// ---------------------------------------------------------------------

const LEGACY_NON_INPUT_KEYS = new Set([
  "quality",
  "qualityIssues",
  "nameQuality",
  "purposeQuality",
  "nameIssues",
  "purposeIssues",
  "approval",
  "nameApproval",
  "purposeApproval",
  "lastSignedContent",
  "lastSignedName",
  "lastSignedPurpose",
  "pendingRemoval",
  "status",
  "approvedAt",
]);

function legacyOmitNonInputFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(legacyOmitNonInputFields);
  if (value == null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !LEGACY_NON_INPUT_KEYS.has(key))
      .map(([key, item]) => [key, legacyOmitNonInputFields(item)]),
  );
}

function list(value: unknown): Snapshot[] {
  return Array.isArray(value) ? (value.filter(isRecord) as Snapshot[]) : [];
}

function legacyScenarioDesign(scenarios: Snapshot[]) {
  const links = (value: unknown) =>
    list(value).map(({ id, type }) => ({ id, type }));
  return scenarios.map((scenario) => ({
    id: scenario.id,
    content: scenario.content,
    description: scenario.description,
    priority: scenario.priority,
    references: links(scenario.references),
    dependencies: Array.isArray(scenario.dependencies) ? [...scenario.dependencies] : [],
    binding: scenario.binding,
    revisionId: scenario.revisionId,
    revision: scenario.revision,
    testCases: list(scenario.testCases).map((testCase) => ({
      id: testCase.id,
      title: testCase.title,
      description: testCase.description,
      priority: testCase.priority,
      references: links(testCase.references),
      dependencies: Array.isArray(testCase.dependencies) ? [...testCase.dependencies] : [],
      definition: testCase.definition,
      revisionId: testCase.revisionId,
      revision: testCase.revision,
    })),
  }));
}

function legacyWorkflowInput(source: Snapshot, step: WorkflowStage): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (step === WorkflowStage.ProductOverview) return result;
  result.productOverview = legacyOmitNonInputFields(source.productOverview);
  if (step === WorkflowStage.UserStories) return result;
  result.userStories = legacyOmitNonInputFields(source.userStories);
  if (step === WorkflowStage.Requirements) return result;
  result.requirements = legacyOmitNonInputFields(source.requirements);
  if (step === WorkflowStage.AcceptanceCriteria) return result;
  result.acceptanceCriteria = legacyOmitNonInputFields(source.acceptanceCriteria);
  if (step === WorkflowStage.BoundaryDesign) return result;
  result.boundaryDesign = legacyOmitNonInputFields(source.boundaryDesign ?? null);
  if (step === WorkflowStage.InterfaceContracts) return result;
  result.implementationProfile = legacyOmitNonInputFields(source.implementationProfile ?? null);
  result.contractSuite = legacyOmitNonInputFields(source.contractSuite ?? null);
  if (step === WorkflowStage.TestScenarios) return result;
  result.testScenarios = legacyScenarioDesign(list(source.testScenarios)).map(
    ({ testCases: _testCases, ...scenario }) => scenario,
  );
  if (step === WorkflowStage.TestCases) return result;
  result.testScenarios = legacyScenarioDesign(list(source.testScenarios));
  if (step === WorkflowStage.ProjectSetup) return result;
  result.projectSetup = legacyOmitNonInputFields(source.projectSetup ?? null);
  return result;
}

function legacyInputHash(source: Snapshot, step: WorkflowStage): string {
  return sha256Text(canonicalJson(legacyWorkflowInput(source, step))).slice(0, 20);
}

// ---------------------------------------------------------------------
// Phase 1: the JSON transform.
// ---------------------------------------------------------------------

const LEGACY_FRAGMENT_KEYS = ["approval", "lastSignedContent", "quality", "qualityIssues"];

function migrateFragment(fragment: Snapshot, legacy: LegacyReview): Snapshot {
  const id = String(fragment.id);
  if (fragment.approval === "approved") legacy.approvedIds.push(id);
  if (typeof fragment.lastSignedContent === "string") {
    legacy.signedTexts[id] = fragment.lastSignedContent;
  }
  const rest = Object.fromEntries(
    Object.entries(fragment).filter(([key]) => !LEGACY_FRAGMENT_KEYS.includes(key)),
  );
  return {
    ...rest,
    approval: null,
    verdict: null,
    basis: null,
    ...(Array.isArray(fragment.testCases)
      ? { testCases: list(fragment.testCases).map((testCase) => migrateFragment(testCase, legacy)) }
      : {}),
  };
}

function migrateArtifact(artifact: unknown, legacy: LegacyReview): unknown {
  if (!isRecord(artifact)) return artifact ?? null;
  const { status, approvedAt: _approvedAt, ...rest } = artifact;
  if (status === "approved") legacy.approvedIds.push(String(artifact.id));
  return { ...rest, approval: null, verdict: null };
}

function migrateOverview(overview: unknown, legacy: LegacyReview): unknown {
  if (!isRecord(overview)) return overview;
  const {
    name: _name,
    nameApproval: _nameApproval,
    purposeApproval,
    lastSignedName: _lastSignedName,
    lastSignedPurpose,
    nameQuality: _nameQuality,
    purposeQuality: _purposeQuality,
    nameIssues: _nameIssues,
    purposeIssues: _purposeIssues,
    ...rest
  } = overview;
  if (purposeApproval === "approved") legacy.approvedIds.push(OVERVIEW_PURPOSE_QUALITY_ID);
  if (typeof lastSignedPurpose === "string") legacy.signedTexts[OVERVIEW_PURPOSE_QUALITY_ID] = lastSignedPurpose;
  return {
    ...rest,
    purposeApproval: null,
    purposeVerdict: null,
    primaryFeatures: list(rest.primaryFeatures).map((item) => migrateFragment(item, legacy)),
    targetUsers: list(rest.targetUsers).map((item) => migrateFragment(item, legacy)),
  };
}

/** Rewrite a schema 3 module snapshot into the current shape. */
export function migrateModuleSnapshotV3(value: Snapshot): { snapshot: Snapshot; legacy: LegacyReview } {
  const legacy: LegacyReview = {
    approvedIds: [],
    signedTexts: {},
    outdatedStages: [],
    boundaryWasCurrent: false,
  };
  const recorded = isRecord(value.stageInputFingerprints) ? value.stageInputFingerprints : {};
  for (const [step, hash] of Object.entries(recorded)) {
    if (!(Object.values(WorkflowStage) as string[]).includes(step)) continue;
    if (hash !== legacyInputHash(value, step as WorkflowStage)) {
      legacy.outdatedStages.push(step as WorkflowStage);
    }
  }
  const design = value.boundaryDesign;
  legacy.boundaryWasCurrent =
    isRecord(design) &&
    design.requirementsRevisionId === fingerprint(value.requirements ?? []) &&
    design.acceptanceCriteriaRevisionId === fingerprint(value.acceptanceCriteria ?? []);

  const suite = value.contractSuite;
  const {
    stageInputFingerprints: _stageInputFingerprints,
    ...rest
  } = value;
  const snapshot: Snapshot = {
    ...rest,
    schemaVersion: MODULE_SCHEMA_VERSION,
    productOverview: migrateOverview(value.productOverview, legacy),
    userStories: list(value.userStories).map((item) => migrateFragment(item, legacy)),
    requirements: list(value.requirements).map((item) => migrateFragment(item, legacy)),
    acceptanceCriteria: list(value.acceptanceCriteria).map((item) => migrateFragment(item, legacy)),
    boundaryDesign: migrateArtifact(value.boundaryDesign, legacy),
    implementationProfile: migrateArtifact(value.implementationProfile, legacy),
    contractSuite: isRecord(suite)
      ? {
          ...suite,
          interfaceContracts: list(suite.interfaceContracts).map((item) => migrateArtifact(item, legacy)),
          subjectContracts: list(suite.subjectContracts).map((item) => migrateArtifact(item, legacy)),
          verificationContracts: list(suite.verificationContracts).map((item) => migrateArtifact(item, legacy)),
        }
      : suite ?? null,
    testScenarios: list(value.testScenarios).map((item) => migrateFragment(item, legacy)),
    projectSetup: migrateArtifact(value.projectSetup, legacy),
    review: EMPTY_REVIEW_BOOK,
  };
  return { snapshot, legacy };
}

export function isLegacyModuleSnapshot(value: unknown): value is Snapshot {
  return isRecord(value) && value.schemaVersion === LEGACY_MODULE_SCHEMA_VERSION;
}

// ---------------------------------------------------------------------
// Phase 2: on the candidate store, where checked hashes are computed.
// ---------------------------------------------------------------------

function signedVersion(content: JsonValue, id: string, text: string, type: StructuralFragment | null): JsonValue {
  const value = content as Record<string, JsonValue>;
  if (id === OVERVIEW_PURPOSE_QUALITY_ID) return { purpose: text };
  if (type === StructuralFragment.TestScenario) return { ...value, title: text };
  if (type === StructuralFragment.TestCase) return { ...value, description: text };
  return { ...value, content: text };
}

/**
 * The checked hash the signed version of a schema 3 draft had, so restoring
 * it re-approves exactly as schema 3 did when an edit landed back on the
 * signed text. A test scenario's or case's signed revision identity was
 * never recorded, so theirs can never hold again.
 */
function signedChecked(
  id: string,
  signed: JsonValue,
  fragment: StructuralFragmentInstance | undefined,
): string {
  const value = signed as Record<string, JsonValue>;
  if (id === OVERVIEW_PURPOSE_QUALITY_ID) return checkedHash({ purpose: value.purpose });
  if (
    fragment == null ||
    fragment.type === StructuralFragment.TestScenario ||
    fragment.type === StructuralFragment.TestCase
  ) {
    return checkedHash({ signedBeforeMigration: signed });
  }
  return checkedHash({
    revision: proseRevision({
      content: value.content as string,
      references: fragment.references,
      dependencies: fragment.dependencies,
    }),
    basis: fragment.basis,
  });
}

/**
 * Record bases, acknowledged inputs, and approvals the way schema 5 holds
 * them. Stages the schema 3 workflow showed as outdated keep unknown bases,
 * so their items stay outdated until regenerated instead of carrying an
 * approval into a state nobody reviewed.
 */
export function completeV3Migration(store: FlatStore, legacy: LegacyReview): void {
  const outdated = new Set(legacy.outdatedStages);
  const items = [
    ...store.productOverview.primaryFeatures,
    ...store.productOverview.targetUsers,
    ...store.userStories,
    ...store.requirements,
    ...store.acceptanceCriteria,
    ...store.testScenarios,
    ...store.testScenarios.flatMap((scenario) => [...scenario.testCases]),
  ] as StructuralFragmentInstance[];
  for (const item of items) {
    const unit = store.reviewUnit(item.id);
    if (unit != null && !outdated.has(unit.stage)) item.setBasis(store.currentBasisOf(item as never));
  }
  if (legacy.boundaryWasCurrent && store.boundaryDesign != null) {
    store.setBoundaryDesign({
      ...store.boundaryDesign,
      requirementsRevisionId: itemSetRevision(store.requirements),
      acceptanceCriteriaRevisionId: itemSetRevision(store.acceptanceCriteria),
    });
  }
  for (const step of Object.keys(STAGE_INPUTS) as WorkflowStage[]) {
    if (!outdated.has(step) && store.hasStepArtifacts(step)) store.acknowledgeInputs(step);
  }
  for (const id of legacy.approvedIds) {
    const unit = store.reviewUnit(id);
    if (unit == null) continue;
    const restorable = unit.kind === "item" || unit.kind === "field";
    store.recordApproval(id, approvalRecord(unit.checked, restorable ? unit.content : null, PERSON));
  }
  for (const [id, text] of Object.entries(legacy.signedTexts)) {
    const unit = store.reviewUnit(id);
    if (unit == null || legacy.approvedIds.includes(id)) continue;
    const fragment = store.structuralFragmentsCache[id];
    const type = fragment?.type ?? null;
    const signed = signedVersion(unit.content, id, text, type);
    store.recordApproval(id, approvalRecord(signedChecked(id, signed, fragment), signed, PERSON));
  }
}
