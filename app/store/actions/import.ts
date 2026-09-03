import { applySnapshot, getSnapshot, getType } from "mobx-state-tree";

import {
  fingerprint,
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
  assertCurrentProjectSchema,
  PROJECT_SCHEMA_VERSION,
} from "lib/projectSchema";
import { parseScaffoldFiles } from "lib/scaffold";
import type { Store } from "store";
import { StructuralFragment } from "store/constants";
import { testDesignFingerprint } from "store/store";

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

const importProject = (self_: unknown, value: unknown): void => {
  const self = self_ as Store;
  assertCurrentProjectSchema(value);
  if (!isRecord(value.productOverview)) throw new InvalidJsonError("Product overview must be an object.");  const candidateSnapshot = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
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
    stageInputFingerprints: isRecord(value.stageInputFingerprints)
      ? value.stageInputFingerprints
      : {},
    conversation: Array.isArray(value.conversation) ? value.conversation : [],
    conversationSidebarOpen: value.conversationSidebarOpen === true,
    // The AI's pending question survives reloads; it only clears when the
    // user or the app actively discards it.
    systemMessage: typeof value.systemMessage === "string" ? value.systemMessage : null,
  };

  const candidate = getType(self).create(candidateSnapshot) as Store;
  if (candidate.boundaryDesign != null) {
    validateBoundaryDesign(candidate.boundaryDesign, {
      requirementIds: new Set(candidate.requirements.map(({ id }) => id)),
      acceptanceCriteriaIds: new Set(candidate.acceptanceCriteria.map(({ id }) => id)),
      requirementsRevisionId: fingerprint(
        candidate.requirements.map((item) => getSnapshot(item)),
      ),
      acceptanceCriteriaRevisionId: fingerprint(
        candidate.acceptanceCriteria.map((item) => getSnapshot(item)),
      ),
    });
  }
  if (candidate.implementationProfile != null) {
    if (candidate.boundaryDesign == null) {
      throw new InvalidJsonError(
        "Implementation profile requires a Boundary Design.",
      );
    }
    validateImplementationProfile(
      candidate.implementationProfile,
      candidate.boundaryDesign.revisionId,
    );
  }
  if (candidate.contractSuite != null) {
    if (candidate.boundaryDesign == null || candidate.implementationProfile == null) {
      throw new InvalidJsonError("Contract suite requires a boundary design and implementation profile.");
    }
    validateContractSuite(candidate.contractSuite, candidate.boundaryDesign, candidate.implementationProfile.revisionId);
    validateLocalDependencies(candidate.testScenarios, "Test scenarios");
    for (const scenario of candidate.testScenarios) {
      if (scenario.binding == null) throw new InvalidJsonError(`Scenario ${scenario.id} has no binding.`);
      validateScenarioBinding(scenario.binding, candidate.boundaryDesign, candidate.contractSuite);
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
      validateScenarioAcceptanceCriteria(
        scenarioCriteria,
        scenario.binding,
        candidate.boundaryDesign,
      );
      validateLocalDependencies(
        scenario.testCases,
        `Test cases for scenario ${scenario.id}`,
      );
      const coveredCriteria = new Set<string>();
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
        if (
          caseCriteria.length === 0 ||
          caseCriteria.some((id) => !scenarioCriteria.includes(id))
        ) {
          throw new InvalidJsonError(
            `Test case ${testCase.id} claims acceptance criteria outside its scenario.`,
          );
        }
        caseCriteria.forEach((id) => coveredCriteria.add(id));
        validateTestCaseDefinition(
          testCase.definition,
          scenario.binding,
          candidate.boundaryDesign,
          candidate.contractSuite,
          scenario.revisionId,
        );
      }
      if (
        scenario.testCases.length > 0 &&
        scenarioCriteria.some((id) => !coveredCriteria.has(id))
      ) {
        throw new InvalidJsonError(
          `Test cases for scenario ${scenario.id} do not cover every claimed acceptance criterion.`,
        );
      }
    }
    if (candidate.projectSetup != null) {
      validateProjectSetup(
        candidate.projectSetup,
        candidate.boundaryDesign,
        candidate.implementationProfile,
        candidate.contractSuite,
        testDesignFingerprint(candidate),
        new Set(candidate.testScenarios.map(({ id }) => id)),
      );
    }
  } else if (candidate.testScenarios.length > 0 || candidate.projectSetup != null) {
    throw new InvalidJsonError(
      "Test scenarios and Project Setup require an approved contract suite.",
    );
  }
  applySnapshot(self, getSnapshot(candidate));
};

export default importProject;
