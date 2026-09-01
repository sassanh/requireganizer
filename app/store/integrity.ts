import { ARTIFACT_STAGE_DEFINITIONS } from "ai-harness/workflow";
import type { BoundaryDesign } from "contract-domain";
import {
  OVERVIEW_NAME_QUALITY_ID,
  OVERVIEW_PURPOSE_QUALITY_ID,
  Quality,
  StructuralFragment,
  WorkflowStage,
} from "store/constants";

export interface IntegrityReference {
  id: string;
  type: StructuralFragment;
}

export interface IntegrityItem {
  id: string;
  type: StructuralFragment;
  content: string;
  references: readonly IntegrityReference[];
  dependencies: readonly string[];
}

export interface IntegrityScenario {
  id: string;
  criterionIds: readonly string[];
  testCases: readonly { id: string; criterionIds: readonly string[] }[];
}

export interface IntegrityGraph {
  productOverview: {
    name: string | null;
    purpose: string | null;
    primaryFeatures: readonly IntegrityItem[];
    targetUsers: readonly IntegrityItem[];
  };
  userStories: readonly IntegrityItem[];
  requirements: readonly IntegrityItem[];
  acceptanceCriteria: readonly IntegrityItem[];
  boundaryDesign: BoundaryDesign | null;
  testScenarios: readonly IntegrityScenario[];
}

export interface MechanicalIssue {
  stage: WorkflowStage;
  itemId: string | null;
  message: string;
}

export function uncoveredIds(
  requiredIds: readonly string[],
  coveringIds: readonly string[],
): string[] {
  const covered = new Set(coveringIds);
  return requiredIds.filter((id) => !covered.has(id));
}

export function aggregateQuality(qualities: readonly Quality[]): Quality {
  if (qualities.length === 0) return Quality.Unchecked;
  if (qualities.some((item) => item === Quality.Bad)) return Quality.Bad;
  if (qualities.some((item) => item === Quality.Unchecked)) return Quality.Unchecked;
  return Quality.Good;
}

export function qualityItemIdsForStage(
  stage: WorkflowStage,
  graph: IntegrityGraph,
): string[] | null {
  switch (stage) {
    case WorkflowStage.ProductOverview:
      return [
        OVERVIEW_NAME_QUALITY_ID,
        OVERVIEW_PURPOSE_QUALITY_ID,
        ...graph.productOverview.primaryFeatures.map(({ id }) => id),
        ...graph.productOverview.targetUsers.map(({ id }) => id),
      ];
    case WorkflowStage.UserStories:
      return graph.userStories.map(({ id }) => id);
    case WorkflowStage.Requirements:
      return graph.requirements.map(({ id }) => id);
    case WorkflowStage.AcceptanceCriteria:
      return graph.acceptanceCriteria.map(({ id }) => id);
    default:
      return null;
  }
}

function coveringReferenceIds(items: readonly IntegrityItem[]): string[] {
  return items.flatMap((item) => item.references.map(({ id }) => id));
}

function knownArtifacts(graph: IntegrityGraph): Map<string, StructuralFragment> {
  const artifacts = new Map<string, StructuralFragment>();
  const remember = (item: IntegrityItem) => artifacts.set(item.id, item.type);
  graph.productOverview.primaryFeatures.forEach(remember);
  graph.productOverview.targetUsers.forEach(remember);
  graph.userStories.forEach(remember);
  graph.requirements.forEach(remember);
  graph.acceptanceCriteria.forEach(remember);
  return artifacts;
}

function itemGraphIssues(
  items: readonly IntegrityItem[],
  stage: WorkflowStage,
  artifacts: Map<string, StructuralFragment>,
  allowedReferenceTypes: readonly StructuralFragment[],
): MechanicalIssue[] {
  const issues: MechanicalIssue[] = [];
  const itemIds = new Set(items.map(({ id }) => id));

  for (const item of items) {
    if (item.content.trim().length === 0) {
      issues.push({
        stage,
        itemId: item.id,
        message: "This item has no content.",
      });
    }
    if (item.references.length === 0) {
      issues.push({
        stage,
        itemId: item.id,
        message: "This item has no references.",
      });
    }
    for (const reference of item.references) {
      const actual = artifacts.get(reference.id);
      if (actual == null || actual !== reference.type) {
        issues.push({
          stage,
          itemId: item.id,
          message: `This item references a missing ${reference.type}.`,
        });
        break;
      }
      if (!allowedReferenceTypes.includes(reference.type)) {
        issues.push({
          stage,
          itemId: item.id,
          message: "This item references something outside its allowed scope.",
        });
        break;
      }
    }
    for (const dependency of item.dependencies) {
      if (!itemIds.has(dependency) || dependency === item.id) {
        issues.push({
          stage,
          itemId: item.id,
          message: "This item has an invalid dependency.",
        });
        break;
      }
    }
  }

  if (hasDependencyCycle(items)) {
    issues.push({
      stage,
      itemId: null,
      message: "Dependencies contain a cycle.",
    });
  }

  return issues;
}

function hasDependencyCycle(items: readonly IntegrityItem[]): boolean {
  const dependenciesById = new Map(
    items.map((item) => [item.id, item.dependencies] as const),
  );
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const dependency of dependenciesById.get(id) ?? []) {
      if (visit(dependency)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return items.some((item) => visit(item.id));
}

function coverageIssues(
  stage: WorkflowStage,
  required: readonly IntegrityItem[],
  covering: readonly IntegrityItem[],
  uncoveredMessage: (item: IntegrityItem) => string,
): MechanicalIssue[] {
  const missing = uncoveredIds(
    required.map(({ id }) => id),
    coveringReferenceIds(covering),
  );
  const byId = new Map(required.map((item) => [item.id, item] as const));
  return missing.map((id) => ({
    stage,
    itemId: id,
    message: uncoveredMessage(byId.get(id)!),
  }));
}

/**
 * Standing graph facts for early stages and downstream coverage.
 * Writing quality is not computed here.
 */
export function collectMechanicalIssues(graph: IntegrityGraph): MechanicalIssue[] {
  const issues: MechanicalIssue[] = [];
  const artifacts = knownArtifacts(graph);

  if (graph.userStories.length > 0) {
    issues.push(
      ...itemGraphIssues(
        graph.userStories,
        WorkflowStage.UserStories,
        artifacts,
        ARTIFACT_STAGE_DEFINITIONS[StructuralFragment.UserStory].allowedReferenceTypes,
      ),
      ...coverageIssues(
        WorkflowStage.UserStories,
        graph.productOverview.primaryFeatures,
        graph.userStories,
        () => "No user story covers this feature.",
      ),
    );
  }

  if (graph.requirements.length > 0) {
    issues.push(
      ...itemGraphIssues(
        graph.requirements,
        WorkflowStage.Requirements,
        artifacts,
        ARTIFACT_STAGE_DEFINITIONS[StructuralFragment.Requirement].allowedReferenceTypes,
      ),
      ...coverageIssues(
        WorkflowStage.Requirements,
        graph.userStories,
        graph.requirements,
        () => "No requirement covers this story.",
      ),
    );
  }

  if (graph.acceptanceCriteria.length > 0) {
    issues.push(
      ...itemGraphIssues(
        graph.acceptanceCriteria,
        WorkflowStage.AcceptanceCriteria,
        artifacts,
        ARTIFACT_STAGE_DEFINITIONS[StructuralFragment.AcceptanceCriteria]
          .allowedReferenceTypes,
      ),
      ...coverageIssues(
        WorkflowStage.AcceptanceCriteria,
        graph.requirements,
        graph.acceptanceCriteria,
        () => "No acceptance criterion covers this requirement.",
      ),
    );
  }

  if (graph.boundaryDesign != null && graph.acceptanceCriteria.length > 0) {
    const covered = graph.boundaryDesign.coverage.map(
      ({ acceptanceCriteriaId }) => acceptanceCriteriaId,
    );
    for (const id of uncoveredIds(
      graph.acceptanceCriteria.map(({ id }) => id),
      covered,
    )) {
      issues.push({
        stage: WorkflowStage.BoundaryDesign,
        itemId: id,
        message: "This criterion has no boundary coverage.",
      });
    }
  }

  if (graph.testScenarios.length > 0 && graph.acceptanceCriteria.length > 0) {
    const claimed = graph.testScenarios.flatMap((scenario) => scenario.criterionIds);
    for (const id of uncoveredIds(
      graph.acceptanceCriteria.map(({ id }) => id),
      claimed,
    )) {
      issues.push({
        stage: WorkflowStage.TestScenarios,
        itemId: id,
        message: "No test scenario claims this criterion.",
      });
    }
  }

  for (const scenario of graph.testScenarios) {
    if (scenario.testCases.length === 0) continue;
    const claimed = scenario.testCases.flatMap((testCase) => testCase.criterionIds);
    for (const id of uncoveredIds(scenario.criterionIds, claimed)) {
      issues.push({
        stage: WorkflowStage.TestCases,
        itemId: id,
        message: "No test case in this scenario claims this criterion.",
      });
    }
  }

  return issues;
}
