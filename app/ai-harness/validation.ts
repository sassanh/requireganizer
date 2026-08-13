import {
  ArtifactListProposal,
  ArtifactProposalItem,
  FragmentRevisionProposal,
  ProductOverviewProposal,
  TestCodeRequest,
  TestCodeProposal,
} from "ai-harness/contracts";
import {
  ArtifactStageDefinition,
  getArtifactStageDefinition,
} from "ai-harness/workflow";
import {
  parseTestCaseDefinition,
  parseTestScenarioBinding,
  renderTestCaseExpectedResult,
  renderTestCaseSteps,
} from "contract-domain";
import { InvalidJsonError, isRecord } from "lib/json";
import { assertSafeVirtualPath } from "lib/scaffold";
import {
  Priority,
  StructuralFragment,
} from "store/constants";
import { isEnumMember } from "utilities";

export interface ArtifactIdentity {
  id: string;
  type: StructuralFragment;
}

const MAX_TEST_CODE_CHARACTERS = 500_000;

function requiredString(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidJsonError(`${label}.${key} must be non-empty text.`);
  }
  return value.trim();
}

function requiredTextPreservingWhitespace(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidJsonError(`${label}.${key} must be non-empty text.`);
  }
  return value;
}

function requiredSingleLineString(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const value = requiredString(record, key, label);
  if (/\r|\n/.test(value)) {
    throw new InvalidJsonError(`${label}.${key} must be a single line.`);
  }
  return value;
}

function assertAllowedKeys(
  record: Record<string, unknown>,
  allowedKeys: readonly string[],
  label: string,
): void {
  const allowed = new Set(allowedKeys);
  const unexpected = Object.keys(record).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    throw new InvalidJsonError(
      `${label} contains unsupported field(s): ${unexpected.join(", ")}.`,
    );
  }
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new InvalidJsonError(`${label}.${key} must be text when provided.`);
  }
  return value;
}

function requiredRecord(
  record: Record<string, unknown>,
  key: string,
  label: string,
): Record<string, unknown> {
  const value = record[key];
  if (!isRecord(value)) {
    throw new InvalidJsonError(`${label}.${key} must be an object.`);
  }
  return value;
}

function requiredArray(
  record: Record<string, unknown>,
  key: string,
  label: string,
): unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    throw new InvalidJsonError(`${label}.${key} must be an array.`);
  }
  return value;
}

function stringArray(
  record: Record<string, unknown>,
  key: string,
  label: string,
  { allowEmpty = true }: { allowEmpty?: boolean } = {},
): string[] {
  const result = requiredArray(record, key, label).map((value, index) => {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new InvalidJsonError(
        `${label}.${key}[${index}] must be non-empty text.`,
      );
    }
    return value.trim();
  });
  if (!allowEmpty && result.length === 0) {
    throw new InvalidJsonError(`${label}.${key} must not be empty.`);
  }
  return result;
}

function enumValue<Value>(
  value: unknown,
  enumObject: Record<string | number | symbol, Value>,
  label: string,
): Value {
  if (!isEnumMember(value, enumObject)) {
    throw new InvalidJsonError(`${label} has an unsupported value.`);
  }
  return value;
}

export function parseProductOverviewProposal(
  value: unknown,
): ProductOverviewProposal {
  if (!isRecord(value)) {
    throw new InvalidJsonError("Product overview result must be an object.");
  }
  assertAllowedKeys(
    value,
    [
      "name",
      "purpose",
      "primaryFeatures",
      "targetUsers",
    ],
    "Product overview",
  );

  return {
    name: requiredString(value, "name", "Product overview"),
    purpose: requiredString(value, "purpose", "Product overview"),
    primaryFeatures: stringArray(value, "primaryFeatures", "Product overview", {
      allowEmpty: false,
    }),
    targetUsers: stringArray(value, "targetUsers", "Product overview", {
      allowEmpty: false,
    }),
  };
}

function collectList(
  value: unknown,
  type: StructuralFragment,
  target: Map<string, ArtifactIdentity>,
): void {
  if (!Array.isArray(value)) return;
  value.forEach((candidate) => {
    if (!isRecord(candidate) || typeof candidate.id !== "string") return;
    target.set(candidate.id, { id: candidate.id, type });
  });
}

export function collectArtifactIdentities(
  state: Record<string, unknown>,
): Map<string, ArtifactIdentity> {
  const artifacts = new Map<string, ArtifactIdentity>();
  const overview = isRecord(state.productOverview) ? state.productOverview : {};
  collectList(
    overview.primaryFeatures,
    StructuralFragment.PrimaryFeature,
    artifacts,
  );
  collectList(overview.targetUsers, StructuralFragment.TargetUser, artifacts);
  collectList(state.userStories, StructuralFragment.UserStory, artifacts);
  collectList(state.requirements, StructuralFragment.Requirement, artifacts);
  collectList(
    state.acceptanceCriteria,
    StructuralFragment.AcceptanceCriteria,
    artifacts,
  );
  return artifacts;
}

export function getExistingTargetIds(
  state: Record<string, unknown>,
  entityType: StructuralFragment,
): Set<string> {
  let list: unknown;
  const overview = isRecord(state.productOverview) ? state.productOverview : {};
  switch (entityType) {
    case StructuralFragment.PrimaryFeature:
      list = overview.primaryFeatures;
      break;
    case StructuralFragment.TargetUser:
      list = overview.targetUsers;
      break;
    case StructuralFragment.UserStory:
      list = state.userStories;
      break;
    case StructuralFragment.Requirement:
      list = state.requirements;
      break;
    case StructuralFragment.AcceptanceCriteria:
      list = state.acceptanceCriteria;
      break;
    case StructuralFragment.TestScenario:
    case StructuralFragment.TestCase:
    case StructuralFragment.TestCode:
      throw new InvalidJsonError(`${entityType} uses the contract-first parser.`);
  }

  return new Set(
    Array.isArray(list)
      ? list
        .filter(
          (candidate): candidate is Record<string, unknown> =>
            isRecord(candidate) && typeof candidate.id === "string",
        )
        .map((candidate) => candidate.id as string)
      : [],
  );
}

function parseReferences(
  value: Record<string, unknown>,
  label: string,
  artifacts: Map<string, ArtifactIdentity>,
  definition: ArtifactStageDefinition,
): ArtifactProposalItem["references"] {
  const seen = new Set<string>();
  return requiredArray(value, "references", label).map((candidate, index) => {
    const referenceLabel = `${label}.references[${index}]`;
    if (!isRecord(candidate)) {
      throw new InvalidJsonError(`${referenceLabel} must be an object.`);
    }
    assertAllowedKeys(candidate, ["id", "type"], referenceLabel);
    const id = requiredString(candidate, "id", referenceLabel);
    if (seen.has(id)) {
      throw new InvalidJsonError(`${label} contains duplicate reference ${id}.`);
    }
    seen.add(id);
    const type = enumValue(candidate.type, StructuralFragment, `${referenceLabel}.type`);
    const actual = artifacts.get(id);
    if (actual == null || actual.type !== type) {
      throw new InvalidJsonError(`${referenceLabel} does not identify an existing ${type}.`);
    }
    if (!definition.allowedReferenceTypes.includes(type)) {
      throw new InvalidJsonError(`${referenceLabel} is outside this stage's allowed scope.`);
    }
    return { id, type };
  });
}

function parseArtifactItem(
  value: unknown,
  index: number,
  definition: ArtifactStageDefinition,
  artifacts: Map<string, ArtifactIdentity>,
  existingTargetIds: Set<string>,
): ArtifactProposalItem {
  const label = `Artifact result.items[${index}]`;
  if (!isRecord(value)) {
    throw new InvalidJsonError(`${label} must be an object.`);
  }

  assertAllowedKeys(
    value,
    ["key", "id", "content", "priority", "references", "dependencies"],
    label,
  );

  const key = requiredSingleLineString(value, "key", label);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(key) || key.length > 80) {
    throw new InvalidJsonError(
      `${label}.key must be 1-80 letters, numbers, underscores, or hyphens and start with a letter or number.`,
    );
  }
  const id = optionalString(value, "id", label);
  if (id !== undefined && !existingTargetIds.has(id)) {
    throw new InvalidJsonError(`${label}.id must identify an existing target item.`);
  }

  const references = parseReferences(value, label, artifacts, definition);
  if (references.length === 0) {
    throw new InvalidJsonError(`${label}.references must not be empty.`);
  }
  const base = {
    key,
    id,
    priority: enumValue(value.priority, Priority, `${label}.priority`),
    references,
    dependencies: stringArray(value, "dependencies", label),
  };

  return {
    ...base,
    content: requiredString(value, "content", label),
  };
}

function assertValidDependencies(items: ArtifactProposalItem[]): void {
  const itemKeys = new Set(items.map(({ key }) => key));
  const dependenciesByKey = new Map<string, string[]>();

  items.forEach((item, index) => {
    const seen = new Set<string>();
    item.dependencies.forEach((dependency) => {
      if (seen.has(dependency)) {
        throw new InvalidJsonError(
          `Artifact result.items[${index}] contains duplicate dependency ${dependency}.`,
        );
      }
      seen.add(dependency);
      if (!itemKeys.has(dependency)) {
        throw new InvalidJsonError(
          `Artifact result.items[${index}] depends on unknown proposal key ${dependency}.`,
        );
      }
      if (item.key === dependency) {
        throw new InvalidJsonError("An artifact cannot depend on itself.");
      }
    });
    dependenciesByKey.set(item.key, item.dependencies);
  });

  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(id: string): void {
    if (visiting.has(id)) {
      throw new InvalidJsonError("Artifact dependencies must not contain cycles.");
    }
    if (visited.has(id)) return;
    visiting.add(id);
    (dependenciesByKey.get(id) ?? []).forEach(visit);
    visiting.delete(id);
    visited.add(id);
  }
  dependenciesByKey.forEach((_, id) => visit(id));
}

function assertCoverage(
  items: ArtifactProposalItem[],
  artifacts: Map<string, ArtifactIdentity>,
  definition: ArtifactStageDefinition,
): void {
  if (definition.coverageReferenceType == null) return;
  const requiredIds = [...artifacts.values()]
    .filter(({ type }) => type === definition.coverageReferenceType)
    .map(({ id }) => id);
  const coveredIds = new Set(
    items.flatMap((item) => item.references.map(({ id }) => id)),
  );
  const missing = requiredIds.filter((id) => !coveredIds.has(id));
  if (missing.length > 0) {
    throw new InvalidJsonError(
      `${definition.entityType} result does not cover ${missing.length} required upstream artifact(s).`,
    );
  }
}

export function parseArtifactListProposal(
  value: unknown,
  {
    expectedEntityType,
    state,
  }: {
    expectedEntityType: StructuralFragment;
    state: Record<string, unknown>;
  },
): ArtifactListProposal {
  if (!isRecord(value)) {
    throw new InvalidJsonError("Artifact-list result must be an object.");
  }
  assertAllowedKeys(value, ["items"], "Artifact result");
  const entityType = expectedEntityType;
  const definition = getArtifactStageDefinition(entityType);
  const artifacts = collectArtifactIdentities(state);
  const existingTargetIds = getExistingTargetIds(state, entityType);
  const rawItems = requiredArray(value, "items", "Artifact result");
  if (rawItems.length === 0) {
    throw new InvalidJsonError("Artifact result.items must not be empty.");
  }
  const items = rawItems.map((item, index) =>
    parseArtifactItem(
      item,
      index,
      definition,
      artifacts,
      existingTargetIds,
    ),
  );

  const ids = items.flatMap((item) => (item.id === undefined ? [] : [item.id]));
  if (new Set(ids).size !== ids.length) {
    throw new InvalidJsonError("Artifact result contains duplicate item ids.");
  }
  const keys = items.map(({ key }) => key);
  if (new Set(keys).size !== keys.length) {
    throw new InvalidJsonError("Artifact result contains duplicate proposal keys.");
  }
  assertValidDependencies(items);
  assertCoverage(items, artifacts, definition);
  return { entityType, items };
}

export function parseFragmentRevisionProposal(
  value: unknown,
  {
    expectedEntityType,
    expectedId,
  }: {
    expectedEntityType: StructuralFragment;
    expectedId: string;
  },
): FragmentRevisionProposal {
  if (!isRecord(value)) {
    throw new InvalidJsonError("Fragment revision result must be an object.");
  }
  assertAllowedKeys(value, ["patch"], "Fragment revision");
  const entityType = expectedEntityType;
  if (
    entityType === StructuralFragment.TestScenario ||
    entityType === StructuralFragment.TestCase ||
    entityType === StructuralFragment.TestCode
  ) {
    throw new InvalidJsonError(`${entityType} uses its contract-first revision flow.`);
  }
  const id = expectedId;
  const rawPatch = requiredRecord(value, "patch", "Fragment revision");
  const patch: FragmentRevisionProposal["patch"] = {};
  const allowedTextFields = ["content"] as const;
  const allowedKeys = new Set<string>([...allowedTextFields, "priority"]);
  Object.keys(rawPatch).forEach((key) => {
    if (!allowedKeys.has(key)) {
      throw new InvalidJsonError(
        `Fragment revision.patch.${key} is not allowed for ${entityType}.`,
      );
    }
  });
  for (const key of allowedTextFields) {
    if (rawPatch[key] !== undefined) {
      patch[key] = requiredString(rawPatch, key, "Fragment revision.patch");
    }
  }
  if (rawPatch.priority !== undefined) {
    patch.priority = enumValue(
      rawPatch.priority,
      Priority,
      "Fragment revision.patch.priority",
    );
  }
  if (Object.keys(patch).length === 0) {
    throw new InvalidJsonError("Fragment revision.patch must contain a change.");
  }
  return { entityType, id, patch };
}

export function parseTestCodeProposal(
  value: unknown,
  expectedPath: string,
): TestCodeProposal {
  if (!isRecord(value)) {
    throw new InvalidJsonError("Test-code result must be an object.");
  }
  assertAllowedKeys(value, ["code"], "Test-code result");
  const proposal = {
    path: assertSafeVirtualPath(expectedPath),
    code: requiredTextPreservingWhitespace(value, "code", "Test-code result"),
  };
  if (proposal.code.length > MAX_TEST_CODE_CHARACTERS) {
    throw new InvalidJsonError("Test-code result exceeds the response size limit.");
  }
  return proposal;
}

export function parseTestCodeRequest(value: unknown): TestCodeRequest {
  if (!isRecord(value)) {
    throw new InvalidJsonError("Test-code request must be an object.");
  }
  assertAllowedKeys(
    value,
    [
      "project",
      "projectConfig",
      "contracts",
      "scaffoldManifest",
      "bindingMetadata",
      "scenario",
      "testCase",
      "targetPath",
      "existingFile",
      "comment",
    ],
    "Test-code request",
  );

  const project = requiredRecord(value, "project", "Test-code request");
  assertAllowedKeys(
    project,
    ["name", "purpose", "language", "framework"],
    "Test-code request.project",
  );
  const scenario = requiredRecord(value, "scenario", "Test-code request");
  assertAllowedKeys(
    scenario,
    ["id", "revisionId", "code", "content", "binding"],
    "Test-code request.scenario",
  );
  const testCase = requiredRecord(value, "testCase", "Test-code request");
  assertAllowedKeys(
    testCase,
    [
      "id",
      "revisionId",
      "code",
      "title",
      "definition",
      "renderedSteps",
      "renderedExpectedResult",
    ],
    "Test-code request.testCase",
  );
  const targetPath = assertSafeVirtualPath(value.targetPath);

  let existingFile: TestCodeRequest["existingFile"] = null;
  if (value.existingFile !== null) {
    if (!isRecord(value.existingFile)) {
      throw new InvalidJsonError(
        "Test-code request.existingFile must be an object or null.",
      );
    }
    assertAllowedKeys(
      value.existingFile,
      ["path", "content"],
      "Test-code request.existingFile",
    );
    const path = assertSafeVirtualPath(value.existingFile.path);
    if (path !== targetPath) {
      throw new InvalidJsonError(
        "Test-code request.existingFile must match targetPath.",
      );
    }
    if (typeof value.existingFile.content !== "string") {
      throw new InvalidJsonError(
        "Test-code request.existingFile.content must be text.",
      );
    }
    existingFile = { path, content: value.existingFile.content };
  }

  const comment = optionalString(value, "comment", "Test-code request");
  if (comment !== undefined && comment.trim().length === 0) {
    throw new InvalidJsonError("Test-code request.comment must not be empty.");
  }

  const bindingMetadata = requiredRecord(
    value,
    "bindingMetadata",
    "Test-code request",
  );
  assertAllowedKeys(
    bindingMetadata,
    ["adapterIds", "interfaceContractRevisionIds", "subjectContractRevisionIds"],
    "Test-code request.bindingMetadata",
  );
  const metadataList = (key: string): string[] => {
    const candidate = bindingMetadata[key];
    if (!Array.isArray(candidate) || candidate.some((item) => typeof item !== "string")) {
      throw new InvalidJsonError(`Test-code request.bindingMetadata.${key} must be a text array.`);
    }
    return [...new Set(candidate as string[])];
  };

  const scenarioRevisionId = requiredSingleLineString(
    scenario,
    "revisionId",
    "Test-code request.scenario",
  );
  const definition = parseTestCaseDefinition(
    testCase.definition,
    "Test-code request.testCase.definition",
  );
  if (definition.scenarioRevisionId !== scenarioRevisionId) {
    throw new InvalidJsonError(
      "Test-code request.testCase.definition must bind the exact scenario revision.",
    );
  }

  const binding = parseTestScenarioBinding(
    scenario.binding,
    "Test-code request.scenario.binding",
  );
  if (definition.kind !== binding.kind) {
    throw new InvalidJsonError(
      "Test-code request.testCase.definition kind must match its scenario binding.",
    );
  }
  if (
    definition.kind === "behavioral" &&
    binding.kind === "behavioral" &&
    (
      definition.subjectId !== binding.subjectId ||
      definition.boundaryRevisionId !== binding.boundaryRevisionId ||
      definition.subjectContractRevisionId !==
        binding.subjectContractRevisionId ||
      definition.interfaceContractRevisionIds.length !==
        binding.interfaceContractRevisionIds.length ||
      definition.interfaceContractRevisionIds.some(
        (id) => !binding.interfaceContractRevisionIds.includes(id),
      )
    )
  ) {
    throw new InvalidJsonError(
      "Test-code request.testCase.definition must bind the scenario's exact subject and contract revisions.",
    );
  }
  if (
    definition.kind === "verification" &&
    binding.kind === "verification" &&
    definition.verificationContractRevisionId !==
      binding.verificationContractRevisionId
  ) {
    throw new InvalidJsonError(
      "Test-code request.testCase.definition must bind the scenario's exact verification contract revision.",
    );
  }

  const contracts = requiredRecord(value, "contracts", "Test-code request");
  assertAllowedKeys(
    contracts,
    [
      "boundaryRevisionId",
      "interfaceContracts",
      "subjectContracts",
      "verificationContracts",
    ],
    "Test-code request.contracts",
  );
  const boundaryRevisionId = requiredSingleLineString(
    contracts,
    "boundaryRevisionId",
    "Test-code request.contracts",
  );
  if (boundaryRevisionId !== binding.boundaryRevisionId) {
    throw new InvalidJsonError(
      "Test-code request.contracts use a different boundary revision than the scenario.",
    );
  }
  const contractRecords = (key: string): Record<string, unknown>[] =>
    requiredArray(contracts, key, "Test-code request.contracts").map(
      (candidate, index) => {
        if (!isRecord(candidate)) {
          throw new InvalidJsonError(
            `Test-code request.contracts.${key}[${index}] must be an object.`,
          );
        }
        return candidate;
      },
    );
  const interfaceContracts = contractRecords("interfaceContracts");
  const subjectContracts = contractRecords("subjectContracts");
  const verificationContracts = contractRecords("verificationContracts");
  const approvedRevision = (
    contract: Record<string, unknown>,
    label: string,
  ): string => {
    if (contract.status !== "approved") {
      throw new InvalidJsonError(`${label} must be approved.`);
    }
    return requiredSingleLineString(contract, "revisionId", label);
  };
  const interfaceRevisionIds = interfaceContracts.map((contract, index) =>
    approvedRevision(
      contract,
      `Test-code request.contracts.interfaceContracts[${index}]`,
    ),
  );
  const subjectRevisionIds = subjectContracts.map((contract, index) =>
    approvedRevision(
      contract,
      `Test-code request.contracts.subjectContracts[${index}]`,
    ),
  );
  const verificationRevisionIds = verificationContracts.map((contract, index) =>
    approvedRevision(
      contract,
      `Test-code request.contracts.verificationContracts[${index}]`,
    ),
  );
  const exactSet = (left: readonly string[], right: readonly string[]) =>
    left.length === right.length && left.every((item) => right.includes(item));
  const adapterIds = interfaceContracts.map((contract, index) => {
    const label = `Test-code request.contracts.interfaceContracts[${index}]`;
    const adapter = requiredRecord(contract, "adapter", label);
    return `${requiredSingleLineString(adapter, "id", `${label}.adapter`)}@${requiredSingleLineString(adapter, "version", `${label}.adapter`)}`;
  });
  if (binding.kind === "behavioral") {
    const interfaceIds = interfaceContracts.map((contract, index) =>
      requiredSingleLineString(
        contract,
        "interfaceId",
        `Test-code request.contracts.interfaceContracts[${index}]`,
      ),
    );
    if (
      !exactSet(interfaceRevisionIds, binding.interfaceContractRevisionIds) ||
      !exactSet(interfaceIds, binding.interfaceIds) ||
      subjectContracts.length !== 1 ||
      subjectRevisionIds[0] !== binding.subjectContractRevisionId ||
      requiredSingleLineString(
        subjectContracts[0],
        "subjectId",
        "Test-code request.contracts.subjectContracts[0]",
      ) !== binding.subjectId ||
      verificationContracts.length !== 0
    ) {
      throw new InvalidJsonError(
        "Test-code request.contracts do not exactly match the behavioral scenario binding.",
      );
    }
  } else if (
    interfaceContracts.length !== 0 ||
    subjectContracts.length !== 0 ||
    verificationContracts.length !== 1 ||
    verificationRevisionIds[0] !== binding.verificationContractRevisionId ||
    requiredSingleLineString(
      verificationContracts[0],
      "verificationObligationId",
      "Test-code request.contracts.verificationContracts[0]",
    ) !== binding.verificationObligationId
  ) {
    throw new InvalidJsonError(
      "Test-code request.contracts do not exactly match the verification scenario binding.",
    );
  }

  const parsedMetadata = {
    adapterIds: metadataList("adapterIds"),
    interfaceContractRevisionIds: metadataList(
      "interfaceContractRevisionIds",
    ),
    subjectContractRevisionIds: metadataList("subjectContractRevisionIds"),
  };
  if (
    !exactSet(parsedMetadata.adapterIds, adapterIds) ||
    !exactSet(
      parsedMetadata.interfaceContractRevisionIds,
      interfaceRevisionIds,
    ) ||
    !exactSet(parsedMetadata.subjectContractRevisionIds, subjectRevisionIds)
  ) {
    throw new InvalidJsonError(
      "Test-code request.bindingMetadata must identify the exact supplied contract revisions and adapters.",
    );
  }

  const scaffoldManifest = requiredRecord(
    value,
    "scaffoldManifest",
    "Test-code request",
  );
  const projectLanguage = requiredString(
    project,
    "language",
    "Test-code request.project",
  );
  if (scaffoldManifest.language !== projectLanguage) {
    throw new InvalidJsonError(
      "Test-code request project language must match the scaffold manifest.",
    );
  }
  const scenarioId = requiredSingleLineString(
    scenario,
    "id",
    "Test-code request.scenario",
  );
  const matchingTargets = requiredArray(
    scaffoldManifest,
    "testTargets",
    "Test-code request.scaffoldManifest",
  ).filter(
    (candidate) => isRecord(candidate) && candidate.scenarioId === scenarioId,
  );
  if (
    matchingTargets.length !== 1 ||
    !isRecord(matchingTargets[0]) ||
    matchingTargets[0].path !== targetPath
  ) {
    throw new InvalidJsonError(
      "Test-code request.targetPath must be the scenario's unique scaffold-manifest target.",
    );
  }

  const renderedSteps = requiredString(
    testCase,
    "renderedSteps",
    "Test-code request.testCase",
  );
  const renderedExpectedResult = requiredString(
    testCase,
    "renderedExpectedResult",
    "Test-code request.testCase",
  );
  if (
    renderedSteps !== renderTestCaseSteps(definition) ||
    renderedExpectedResult !== renderTestCaseExpectedResult(definition)
  ) {
    throw new InvalidJsonError(
      "Test-code request human-readable steps must be rendered from its structured definition.",
    );
  }

  return {
    project: {
      name: requiredString(project, "name", "Test-code request.project"),
      purpose: requiredString(project, "purpose", "Test-code request.project"),
      framework: requiredString(project, "framework", "Test-code request.project"),
      language: projectLanguage,
    },
    projectConfig: requiredRecord(value, "projectConfig", "Test-code request"),
    contracts,
    scaffoldManifest,
    bindingMetadata: parsedMetadata,
    scenario: {
      id: scenarioId,
      revisionId: scenarioRevisionId,
      code: requiredSingleLineString(scenario, "code", "Test-code request.scenario"),
      content: requiredString(scenario, "content", "Test-code request.scenario"),
      binding,
    },
    testCase: {
      id: requiredSingleLineString(testCase, "id", "Test-code request.testCase"),
      revisionId: requiredSingleLineString(
        testCase,
        "revisionId",
        "Test-code request.testCase",
      ),
      code: requiredSingleLineString(testCase, "code", "Test-code request.testCase"),
      title: requiredSingleLineString(testCase, "title", "Test-code request.testCase"),
      definition,
      renderedSteps,
      renderedExpectedResult,
    },
    targetPath,
    existingFile,
    ...(comment === undefined ? {} : { comment: comment.trim() }),
  };
}
