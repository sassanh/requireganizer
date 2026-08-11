import {
  ArtifactListProposal,
  ArtifactProposalItem,
  FragmentRevisionProposal,
  ProductOverviewProposal,
  ProjectConfigurationProposal,
  ScaffoldProposal,
  TestCodeRequest,
  TestCodeProposal,
} from "ai-harness/contracts";
import {
  ArtifactStageDefinition,
  getArtifactStageDefinition,
} from "ai-harness/workflow";
import { InvalidJsonError, isRecord } from "lib/json";
import { assertSafeVirtualPath, parseScaffoldFiles } from "lib/scaffold";
import {
  Framework,
  Priority,
  PROGRAMMING_LANGUAGE_BY_FRAMEWORK,
  ProgrammingLanguage,
  StructuralFragment,
} from "store/constants";
import { isEnumMember } from "utilities";

export interface ArtifactIdentity {
  id: string;
  type: StructuralFragment;
}

const MAX_SCAFFOLD_FILES = 100;
const MAX_SCAFFOLD_FILE_CHARACTERS = 500_000;
const MAX_SCAFFOLD_TOTAL_CHARACTERS = 2_000_000;
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
      "framework",
      "programmingLanguage",
    ],
    "Product overview",
  );

  const framework = enumValue(
    value.framework,
    Framework,
    "Product overview framework",
  );
  const programmingLanguage = enumValue(
    value.programmingLanguage,
    ProgrammingLanguage,
    "Product overview programming language",
  );
  if (!PROGRAMMING_LANGUAGE_BY_FRAMEWORK[framework].includes(programmingLanguage)) {
    throw new InvalidJsonError(
      `Programming language ${programmingLanguage} is not supported by ${framework}.`,
    );
  }

  return {
    name: requiredString(value, "name", "Product overview"),
    purpose: requiredString(value, "purpose", "Product overview"),
    primaryFeatures: stringArray(value, "primaryFeatures", "Product overview", {
      allowEmpty: false,
    }),
    targetUsers: stringArray(value, "targetUsers", "Product overview", {
      allowEmpty: false,
    }),
    framework,
    programmingLanguage,
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
  collectList(state.testScenarios, StructuralFragment.TestScenario, artifacts);
  if (Array.isArray(state.testScenarios)) {
    state.testScenarios.forEach((scenario) => {
      if (isRecord(scenario)) {
        collectList(scenario.testCases, StructuralFragment.TestCase, artifacts);
      }
    });
  }
  return artifacts;
}

export function getExistingTargetIds(
  state: Record<string, unknown>,
  entityType: StructuralFragment,
  parentId?: string,
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
      list = state.testScenarios;
      break;
    case StructuralFragment.TestCase:
      list = Array.isArray(state.testScenarios)
        ? state.testScenarios.find(
          (scenario) => isRecord(scenario) && scenario.id === parentId,
        )
        : undefined;
      list = isRecord(list) ? list.testCases : undefined;
      break;
    case StructuralFragment.TestCode:
      list = [];
      break;
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
    definition.entityType === StructuralFragment.TestCase
      ? [
        "key",
        "id",
        "title",
        "steps",
        "expectedResult",
        "priority",
        "references",
        "dependencies",
      ]
      : ["key", "id", "content", "priority", "references", "dependencies"],
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

  if (definition.entityType === StructuralFragment.TestCase) {
    return {
      ...base,
      content: optionalString(value, "content", label) ?? "",
      title: requiredSingleLineString(value, "title", label),
      steps: requiredString(value, "steps", label),
      expectedResult: requiredString(value, "expectedResult", label),
    };
  }

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
    expectedParentId,
    state,
  }: {
    expectedEntityType: StructuralFragment;
    expectedParentId?: string;
    state: Record<string, unknown>;
  },
): ArtifactListProposal {
  if (!isRecord(value)) {
    throw new InvalidJsonError("Artifact-list result must be an object.");
  }
  assertAllowedKeys(value, ["items"], "Artifact result");
  const entityType = expectedEntityType;
  const parentId = expectedParentId;

  const definition = getArtifactStageDefinition(entityType);
  const artifacts = collectArtifactIdentities(state);
  const existingTargetIds = getExistingTargetIds(state, entityType, parentId);
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
  if (entityType === StructuralFragment.TestCase && expectedParentId != null) {
    items.forEach((item, index) => {
      if (!item.references.some(({ id }) => id === expectedParentId)) {
        throw new InvalidJsonError(
          `Artifact result.items[${index}] must reference its parent scenario.`,
        );
      }
      if (
        item.references.some(
          ({ id, type }) =>
            type === StructuralFragment.TestScenario && id !== expectedParentId,
        )
      ) {
        throw new InvalidJsonError(
          `Artifact result.items[${index}] must not reference another scenario.`,
        );
      }
    });
  }

  assertValidDependencies(items);
  assertCoverage(items, artifacts, definition);
  return { entityType, parentId, items };
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
  const id = expectedId;
  const rawPatch = requiredRecord(value, "patch", "Fragment revision");
  const patch: FragmentRevisionProposal["patch"] = {};
  const allowedTextFields =
    entityType === StructuralFragment.TestCase
      ? (["title", "steps", "expectedResult"] as const)
      : (["content"] as const);
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
      patch[key] =
        key === "title"
          ? requiredSingleLineString(rawPatch, key, "Fragment revision.patch")
          : requiredString(rawPatch, key, "Fragment revision.patch");
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

export function parseProjectConfigurationProposal(
  value: unknown,
): ProjectConfigurationProposal {
  if (!isRecord(value)) {
    throw new InvalidJsonError("Project configuration result must be an object.");
  }
  assertAllowedKeys(
    value,
    ["packageManager", "testFramework", "buildCommand", "testCommand", "settings"],
    "Project configuration",
  );
  return {
    packageManager: requiredSingleLineString(
      value,
      "packageManager",
      "Project configuration",
    ),
    testFramework: requiredSingleLineString(
      value,
      "testFramework",
      "Project configuration",
    ),
    buildCommand: requiredSingleLineString(
      value,
      "buildCommand",
      "Project configuration",
    ),
    testCommand: requiredSingleLineString(
      value,
      "testCommand",
      "Project configuration",
    ),
    settings: requiredRecord(value, "settings", "Project configuration"),
  };
}

export function parseScaffoldProposal(value: unknown): ScaffoldProposal {
  if (!isRecord(value)) {
    throw new InvalidJsonError("Scaffold result must be an object.");
  }
  assertAllowedKeys(value, ["files"], "Scaffold result");
  const files = parseScaffoldFiles(value.files);
  if (files.length === 0) {
    throw new InvalidJsonError("Scaffold result.files must not be empty.");
  }
  if (files.length > MAX_SCAFFOLD_FILES) {
    throw new InvalidJsonError(
      `Scaffold result.files must contain at most ${MAX_SCAFFOLD_FILES} files.`,
    );
  }
  let totalCharacters = 0;
  files.forEach((file) => {
    if (file.content.length > MAX_SCAFFOLD_FILE_CHARACTERS) {
      throw new InvalidJsonError(
        `Scaffold file ${file.path} exceeds the response size limit.`,
      );
    }
    totalCharacters += file.content.length;
  });
  if (totalCharacters > MAX_SCAFFOLD_TOTAL_CHARACTERS) {
    throw new InvalidJsonError("Scaffold result exceeds the total response size limit.");
  }
  return { files };
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
    ["name", "purpose", "framework", "programmingLanguage"],
    "Test-code request.project",
  );
  const framework = enumValue(
    project.framework,
    Framework,
    "Test-code request.project.framework",
  );
  const programmingLanguage = enumValue(
    project.programmingLanguage,
    ProgrammingLanguage,
    "Test-code request.project.programmingLanguage",
  );
  if (!PROGRAMMING_LANGUAGE_BY_FRAMEWORK[framework].includes(programmingLanguage)) {
    throw new InvalidJsonError(
      "Test-code request contains an incompatible framework-language pair.",
    );
  }

  const scenario = requiredRecord(value, "scenario", "Test-code request");
  assertAllowedKeys(
    scenario,
    ["id", "code", "content"],
    "Test-code request.scenario",
  );
  const testCase = requiredRecord(value, "testCase", "Test-code request");
  assertAllowedKeys(
    testCase,
    ["id", "code", "title", "steps", "expectedResult"],
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

  return {
    project: {
      name: requiredString(project, "name", "Test-code request.project"),
      purpose: requiredString(project, "purpose", "Test-code request.project"),
      framework,
      programmingLanguage,
    },
    projectConfig: requiredRecord(value, "projectConfig", "Test-code request"),
    scenario: {
      id: requiredSingleLineString(scenario, "id", "Test-code request.scenario"),
      code: requiredSingleLineString(scenario, "code", "Test-code request.scenario"),
      content: requiredString(scenario, "content", "Test-code request.scenario"),
    },
    testCase: {
      id: requiredSingleLineString(testCase, "id", "Test-code request.testCase"),
      code: requiredSingleLineString(testCase, "code", "Test-code request.testCase"),
      title: requiredSingleLineString(testCase, "title", "Test-code request.testCase"),
      steps: requiredString(testCase, "steps", "Test-code request.testCase"),
      expectedResult: requiredString(
        testCase,
        "expectedResult",
        "Test-code request.testCase",
      ),
    },
    targetPath,
    existingFile,
    ...(comment === undefined ? {} : { comment: comment.trim() }),
  };
}
