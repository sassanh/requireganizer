import { applySnapshot, getSnapshot, getType } from "mobx-state-tree";

import {
  type BoundaryDesign,
  validateBoundaryDesign,
  validateContractSuite,
  validateImplementationProfile,
  validateProjectSetup,
  validateScenarioAcceptanceCriteria,
  validateScenarioBinding,
  validateTestCaseDefinition,
} from "contract-domain";
import { InvalidJsonError, isRecord } from "lib/json";
import {
  assertModuleSnapshotSchema,
  MODULE_SCHEMA_VERSION,
} from "lib/projectSchema";
import { parseScaffoldFiles } from "lib/scaffold";
import type { Store } from "store";
import { StructuralFragment } from "store/constants";
import { EMPTY_REVIEW_BOOK } from "store/review";
import { testDesignFingerprint } from "store/store";

import {
  completeV3Migration,
  isLegacyModuleSnapshot,
  type LegacyReview,
  migrateModuleSnapshotV3,
} from "./migration";

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new InvalidJsonError(`${label} must be an array.`);
  return value;
}

function validateLocalDependencies(
  items: readonly { id: string; dependencies: readonly string[] }[],
  label: string,
): void {
  const ids = new Set(items.map(({ id }) => id));
  if (ids.size !== items.length) {
    throw new InvalidJsonError(`${label} contains duplicate artifact IDs.`);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) {
      throw new InvalidJsonError(`${label} dependencies contain a cycle.`);
    }
    if (visited.has(id)) return;
    visiting.add(id);
    const item = items.find((candidate) => candidate.id === id)!;
    for (const dependency of item.dependencies) {
      if (!ids.has(dependency)) {
        throw new InvalidJsonError(
          `${label} dependency ${dependency} is outside its artifact set.`,
        );
      }
      if (dependency === id) {
        throw new InvalidJsonError(`${label} artifact ${id} depends on itself.`);
      }
      visit(dependency);
    }
    visiting.delete(id);
    visited.add(id);
  };
  items.forEach(({ id }) => visit(id));
}

/**
 * The ids a boundary design itself cites: a stale design is checked for
 * internal consistency against them, since the upstream it was built from
 * has moved on.
 */
function boundaryOwnContext(design: BoundaryDesign) {
  const requirementIds = new Set<string>();
  const acceptanceCriteriaIds = new Set<string>();
  for (const cited of [...design.subjects, ...design.interactions, ...design.verificationObligations]) {
    cited.requirementIds.forEach((id) => requirementIds.add(id));
    cited.acceptanceCriteriaIds.forEach((id) => acceptanceCriteriaIds.add(id));
  }
  design.coverage.forEach(({ acceptanceCriteriaId }) => acceptanceCriteriaIds.add(acceptanceCriteriaId));
  return { requirementIds, acceptanceCriteriaIds };
}

/**
 * The one gate every stored or imported module passes. Schema 3 modules
 * migrate first. Every artifact is checked for internal structure; current
 * artifacts are also validated against the upstream they bind. Stale
 * artifacts are a legal state — visible, read-only, regenerated later — so
 * staleness never rejects a module.
 */
const importProject = (self_: unknown, value: unknown): void => {
  const self = self_ as Store;
  let legacy: LegacyReview | null = null;
  if (isLegacyModuleSnapshot(value)) {
    const migrated = migrateModuleSnapshotV3(value);
    value = migrated.snapshot;
    legacy = migrated.legacy;
  }
  assertModuleSnapshotSchema(value);
  if (!isRecord(value.productOverview)) throw new InvalidJsonError("Product overview must be an object.");
  const candidateSnapshot = {
    schemaVersion: MODULE_SCHEMA_VERSION,
    isClean: false,
    businessCounter: 0,
    validationErrors: null,
    productOverview: value.productOverview,
    overviewSeed: typeof value.overviewSeed === "string" ? value.overviewSeed : null,
    userStories: array(value.userStories, "User stories"),
    requirements: array(value.requirements, "Requirements"),
    acceptanceCriteria: array(value.acceptanceCriteria, "Acceptance criteria"),
    boundaryDesign: value.boundaryDesign ?? null,
    implementationProfile: value.implementationProfile ?? null,
    contractSuite: value.contractSuite ?? null,
    testScenarios: array(value.testScenarios, "Test scenarios"),
    projectSetup: value.projectSetup ?? null,
    scaffoldFiles: parseScaffoldFiles(value.scaffoldFiles ?? []),
    review: isRecord(value.review) ? value.review : EMPTY_REVIEW_BOOK,
    conversation: Array.isArray(value.conversation) ? value.conversation : [],
    conversationSidebarOpen: value.conversationSidebarOpen === true,
    // The AI's pending question survives reloads; it only clears when the
    // user or the app actively discards it.
    systemMessage: typeof value.systemMessage === "string" ? value.systemMessage : null,
  };

  const candidate = getType(self).create(candidateSnapshot) as Store;
  if (legacy != null) completeV3Migration(candidate, legacy);
  const design = candidate.boundaryDesign;
  if (design != null) {
    validateBoundaryDesign(
      design,
      candidate.reviewUnit(design.id)?.outdated === false
        ? {
            requirementIds: new Set(candidate.requirements.map(({ id }) => id)),
            acceptanceCriteriaIds: new Set(candidate.acceptanceCriteria.map(({ id }) => id)),
          }
        : boundaryOwnContext(design),
    );
  }
  const profile = candidate.implementationProfile;
  if (profile != null) {
    if (design == null) {
      throw new InvalidJsonError("Implementation profile requires a Boundary Design.");
    }
    validateImplementationProfile(
      profile,
      profile.boundaryRevisionId === design.revisionId ? design.revisionId : undefined,
    );
  }
  const suite = candidate.contractSuite;
  if (suite != null) {
    if (design == null || profile == null) {
      throw new InvalidJsonError("Contract suite requires a boundary design and implementation profile.");
    }
    const suiteIsCurrent =
      suite.boundaryRevisionId === design.revisionId &&
      suite.profileRevisionId === profile.revisionId;
    if (suiteIsCurrent) validateContractSuite(suite, design, profile.revisionId);
    validateLocalDependencies(candidate.testScenarios, "Test scenarios");
    for (const scenario of candidate.testScenarios) {
      if (scenario.binding == null) throw new InvalidJsonError(`Scenario ${scenario.id} has no binding.`);
      if (
        scenario.references.some(
          ({ type }) => type !== StructuralFragment.AcceptanceCriteria,
        )
      ) {
        throw new InvalidJsonError(
          `Scenario ${scenario.id} contains a reference outside acceptance criteria.`,
        );
      }
      const scenarioCriteria = scenario.references.map(({ id }) => id);
      const scenarioIsCurrent = suiteIsCurrent && candidate.scenarioBindingIsCurrent(scenario.binding);
      if (scenarioIsCurrent) {
        validateScenarioBinding(scenario.binding, design, suite);
        validateScenarioAcceptanceCriteria(scenarioCriteria, scenario.binding, design);
      }
      validateLocalDependencies(
        scenario.testCases,
        `Test cases for scenario ${scenario.id}`,
      );
      const coveredCriteria = new Set<string>();
      let casesAreCurrent = scenarioIsCurrent;
      for (const testCase of scenario.testCases) {
        if (testCase.definition == null) throw new InvalidJsonError(`Test case ${testCase.id} has no structured definition.`);
        const parentReferences = testCase.references.filter(
          ({ type }) => type === StructuralFragment.TestScenario,
        );
        if (
          parentReferences.length !== 1 ||
          parentReferences[0].id !== scenario.id ||
          testCase.references.some(
            ({ type }) =>
              type !== StructuralFragment.TestScenario &&
              type !== StructuralFragment.AcceptanceCriteria,
          )
        ) {
          throw new InvalidJsonError(
            `Test case ${testCase.id} must reference exactly its parent scenario and acceptance criteria.`,
          );
        }
        const caseCriteria = testCase.references
          .filter(({ type }) => type === StructuralFragment.AcceptanceCriteria)
          .map(({ id }) => id);
        if (caseCriteria.length === 0) {
          throw new InvalidJsonError(`Test case ${testCase.id} claims no acceptance criterion.`);
        }
        caseCriteria.forEach((id) => coveredCriteria.add(id));
        const caseIsCurrent =
          scenarioIsCurrent &&
          testCase.definition.scenarioRevisionId === scenario.revisionId &&
          candidate.caseDefinitionIsCurrent(testCase.definition);
        casesAreCurrent &&= caseIsCurrent;
        if (!caseIsCurrent) continue;
        if (caseCriteria.some((id) => !scenarioCriteria.includes(id))) {
          throw new InvalidJsonError(
            `Test case ${testCase.id} claims acceptance criteria outside its scenario.`,
          );
        }
        validateTestCaseDefinition(
          testCase.definition,
          scenario.binding,
          design,
          suite,
          scenario.revisionId,
        );
      }
      if (
        casesAreCurrent &&
        scenario.testCases.length > 0 &&
        scenarioCriteria.some((id) => !coveredCriteria.has(id))
      ) {
        throw new InvalidJsonError(
          `Test cases for scenario ${scenario.id} do not cover every claimed acceptance criterion.`,
        );
      }
    }
    if (candidate.projectSetup != null && candidate.projectSetupIsCurrent) {
      validateProjectSetup(
        candidate.projectSetup,
        design,
        profile,
        suite,
        testDesignFingerprint(candidate),
        new Set(candidate.testScenarios.map(({ id }) => id)),
      );
    }
  } else if (candidate.testScenarios.length > 0 || candidate.projectSetup != null) {
    throw new InvalidJsonError(
      "Test scenarios and Project Setup require a contract suite.",
    );
  }
  applySnapshot(self, getSnapshot(candidate));
};

export default importProject;
