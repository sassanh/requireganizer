import {
  type ApprovalRecord,
  type JsonValue,
  type ModelVerdict,
  type Reviewer,
  fingerprint,
} from "contract-domain";

import { StructuralFragment, WorkflowStage } from "./constants";

export type { ApprovalRecord, ModelVerdict, Reviewer } from "contract-domain";

export const PERSON: Reviewer = { kind: "person" };

export type ReviewMode = "manual" | "auto";

/** Review state of a unit that has no artifact to carry it: coverage and impact. */
export interface StandaloneReview {
  approval: ApprovalRecord | null;
  verdict: ModelVerdict | null;
}

/**
 * The stage-level review bookkeeping of one module: standalone unit
 * reviews, the input content each stage last acknowledged, and each
 * stage's review mode. Frozen as a whole so the timeline and the
 * presentation replica treat it as one value.
 */
export interface ReviewBook {
  units: Record<string, StandaloneReview>;
  acknowledgedInputs: Partial<Record<WorkflowStage, Record<string, JsonValue>>>;
  modes: Partial<Record<WorkflowStage, ReviewMode>>;
}

export const EMPTY_REVIEW_BOOK: ReviewBook = {
  units: {},
  acknowledgedInputs: {},
  modes: {},
};

const COVERAGE_PREFIX = "coverage:";
const IMPACT_PREFIX = "impact:";

/** The coverage unit of one upstream item: its referencing items cover it fully. */
export function coverageUnitId(parentId: string): string {
  return `${COVERAGE_PREFIX}${parentId}`;
}

export function coverageParentId(unitId: string): string | null {
  return unitId.startsWith(COVERAGE_PREFIX)
    ? unitId.slice(COVERAGE_PREFIX.length)
    : null;
}

/** The impact unit of a list stage: an upstream change affects none of its untouched items. */
export function impactUnitId(stage: WorkflowStage): string {
  return `${IMPACT_PREFIX}${stage}`;
}

export function impactStage(unitId: string): WorkflowStage | null {
  if (!unitId.startsWith(IMPACT_PREFIX)) return null;
  const stage = unitId.slice(IMPACT_PREFIX.length);
  return (Object.values(WorkflowStage) as string[]).includes(stage)
    ? (stage as WorkflowStage)
    : null;
}

/** The revision of a prose unit: its content and the links it declares. */
export function proseRevision(value: {
  content: string;
  references: readonly { id: string; type: string }[];
  dependencies: readonly string[];
}): string {
  return fingerprint({
    content: value.content,
    references: value.references.map(({ id, type }) => ({ id, type })),
    dependencies: [...value.dependencies],
  });
}

/** One hash for any reviewable value; key order does not matter. */
export function checkedHash(value: unknown): string {
  return fingerprint(value);
}

export function holds(
  record: { checked: string } | null | undefined,
  checked: string,
): boolean {
  return record != null && record.checked === checked;
}

/** A sorted id-to-revision listing, so set membership hashes stably. */
export function revisionListing(
  entries: Iterable<readonly [string, string]>,
): [string, string][] {
  return [...entries].sort(([left], [right]) => left.localeCompare(right)) as [
    string,
    string,
  ][];
}

export function approvalRecord(
  checked: string,
  signed: JsonValue | null,
  reviewer: Reviewer,
  overruled?: ModelVerdict | null,
  inputs?: string,
): ApprovalRecord {
  return {
    checked,
    signed,
    reviewer,
    at: new Date().toISOString(),
    ...(inputs != null ? { inputs } : {}),
    ...(overruled != null
      ? {
          overruled: {
            verdict: overruled.verdict,
            reason: overruled.reason,
            model: overruled.model,
          },
        }
      : {}),
  };
}

export function reviewerLabel(reviewer: Reviewer): string {
  return reviewer.kind === "person" ? "a person" : reviewer.model;
}

/** Stages whose completion the frontier walks; Code is outside the workflow. */
export const PROGRESS_STAGES: readonly WorkflowStage[] = Object.values(WorkflowStage)
  .filter((step) => step !== WorkflowStage.Code);

/**
 * A stage's inputs are only the stages its items reference; earlier
 * stages reach it through them.
 */
export const STAGE_INPUTS: Partial<Record<WorkflowStage, readonly WorkflowStage[]>> = {
  [WorkflowStage.UserStories]: [WorkflowStage.ProductOverview],
  [WorkflowStage.Requirements]: [WorkflowStage.ProductOverview, WorkflowStage.UserStories],
  [WorkflowStage.AcceptanceCriteria]: [WorkflowStage.UserStories, WorkflowStage.Requirements],
  [WorkflowStage.BoundaryDesign]: [WorkflowStage.Requirements, WorkflowStage.AcceptanceCriteria],
  [WorkflowStage.InterfaceContracts]: [WorkflowStage.BoundaryDesign],
  [WorkflowStage.TestScenarios]: [
    WorkflowStage.AcceptanceCriteria,
    WorkflowStage.BoundaryDesign,
    WorkflowStage.InterfaceContracts,
  ],
  [WorkflowStage.TestCases]: [WorkflowStage.AcceptanceCriteria, WorkflowStage.TestScenarios],
  [WorkflowStage.ProjectSetup]: [
    WorkflowStage.BoundaryDesign,
    WorkflowStage.InterfaceContracts,
    WorkflowStage.TestScenarios,
    WorkflowStage.TestCases,
  ],
};

/** List stages: an upstream change can leave some of their items untouched. */
export const IMPACT_STAGES: ReadonlySet<WorkflowStage> = new Set([
  WorkflowStage.UserStories,
  WorkflowStage.Requirements,
  WorkflowStage.AcceptanceCriteria,
  WorkflowStage.TestScenarios,
  WorkflowStage.TestCases,
]);

/** Each upstream item of these stages needs a coverage approval. */
export const COVERAGE_STAGE_BY_PARENT_TYPE: Partial<Record<StructuralFragment, WorkflowStage>> = {
  [StructuralFragment.PrimaryFeature]: WorkflowStage.UserStories,
  [StructuralFragment.UserStory]: WorkflowStage.Requirements,
  [StructuralFragment.Requirement]: WorkflowStage.AcceptanceCriteria,
};

export const COVERAGE_STAGES: ReadonlySet<WorkflowStage> = new Set(
  Object.values(COVERAGE_STAGE_BY_PARENT_TYPE),
);

/** The revision a basis records for a referenced unit that no longer exists. */
export const MISSING_REVISION = "missing";

/** The revision of a whole prose list, as Boundary Design records it. */
export function itemSetRevision(
  items: readonly {
    id: string;
    content: string;
    references: readonly { id: string; type: string }[];
    dependencies: readonly string[];
  }[],
): string {
  return checkedHash(revisionListing(items.map((item) => [item.id, proseRevision(item)] as const)));
}

export type ReviewUnitKind = "field" | "item" | "artifact" | "coverage" | "impact";

/** Everything the workflow knows about one reviewable unit, derived in one place. */
export interface ReviewUnit {
  id: string;
  stage: WorkflowStage;
  kind: ReviewUnitKind;
  /** Hash of what an approval or verdict must match to hold. */
  checked: string;
  /** What a reviewer reads; for items and fields also what a restore writes back. */
  content: JsonValue;
  outdated: boolean;
  pendingRemoval: boolean;
  approval: ApprovalRecord | null;
  verdict: ModelVerdict | null;
  approved: boolean;
}

/** The one text a signed version shows in a standing word diff. */
export function signedText(
  signed: JsonValue,
  type: StructuralFragment | null,
): string | null {
  if (signed == null || typeof signed !== "object" || Array.isArray(signed)) return null;
  const value = signed as Record<string, JsonValue>;
  const pick = (key: string) => (typeof value[key] === "string" ? (value[key] as string) : null);
  switch (type) {
    case StructuralFragment.TestScenario:
      return pick("title");
    case StructuralFragment.TestCase:
      return pick("description");
    case null:
      return pick("name") ?? pick("purpose");
    default:
      return pick("content");
  }
}
