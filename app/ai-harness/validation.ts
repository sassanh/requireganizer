import {
  ArtifactListProposal,
  ArtifactProposalItem,
  FragmentRevisionProposal,
  ProductOverviewPatchItem,
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
import { codesMatch, formatCode } from "lib/fragmentCodes";
import { InvalidJsonError, isRecord } from "lib/json";
import { assertSafeVirtualPath } from "lib/scaffold";
import {
  FRAGMENT_CODES,
  Priority,
  StructuralFragment,
} from "store/constants";
import { uncoveredIds } from "store/integrity";
import { isEnumMember } from "utilities";

export interface ArtifactIdentity {
  id: string;
  code: string;
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

/**
 * Collects each entry's problem instead of stopping at the first, so one
 * rejected submission reports everything it must fix.
 */
function collectingProblems() {
  const problems: string[] = [];
  return {
    attempt<Value>(parse: () => Value): Value | undefined {
      try {
        return parse();
      } catch (error) {
        if (!(error instanceof InvalidJsonError)) throw error;
        problems.push(error.message);
        return undefined;
      }
    },
    report(problem: string): void {
      problems.push(problem);
    },
    throwIfAny(): void {
      if (problems.length > 0) throw new InvalidJsonError(problems.join("\n"));
    },
  };
}

/**
 * Codes are positions, so one read before the lists last changed can name
 * other items now. A submission says which read its codes come from.
 */
function assertCurrentCodes(
  value: Record<string, unknown>,
  codesVersion: string,
  label: string,
): void {
  const given = value.codesVersion;
  if (typeof given !== "string" || given.length === 0) {
    throw new InvalidJsonError(
      `${label}.codesVersion must be the codesVersion of the get_items read whose codes this submission uses.`,
    );
  }
  if (given !== codesVersion) {
    throw new InvalidJsonError(
      `Codes may have moved since the get_items read with codesVersion ${given}: a list that codes name has changed since. Read the items again with get_items and submit with its codesVersion.`,
    );
  }
}

/** Reports, by code, each existing item that one list names more than once. */
function reportRepeatedItems(
  ids: string[],
  artifacts: Map<string, ArtifactIdentity>,
  label: string,
  report: (problem: string) => void,
): void {
  new Set(ids.filter((id, index) => ids.indexOf(id) !== index)).forEach((id) => {
    report(`${label} names ${artifacts.get(id)?.code ?? id} more than once.`);
  });
}

/** The item a submission names, by its code however padded, or by its id. */
function identityNamed(
  name: string,
  artifacts: Map<string, ArtifactIdentity>,
): ArtifactIdentity | undefined {
  const trimmed = name.trim();
  return artifacts.get(trimmed) ?? [...artifacts.values()].find(({ code }) => codesMatch(trimmed, code));
}

/** The id of the existing item of `type` that `name` names. */
function existingIdNamed(
  name: string,
  type: StructuralFragment,
  artifacts: Map<string, ArtifactIdentity>,
  label: string,
): string {
  const identity = identityNamed(name, artifacts);
  if (identity?.type !== type) {
    throw new InvalidJsonError(`${label} names ${name}, which is no existing ${type}.`);
  }
  return identity.id;
}

export function parseProductOverviewProposal(
  value: unknown,
  {
    state,
    codesVersion,
  }: {
    state: Record<string, unknown>;
    codesVersion: string;
  },
): ProductOverviewProposal {
  if (!isRecord(value)) {
    throw new InvalidJsonError("Product overview result must be an object.");
  }
  assertAllowedKeys(
    value,
    ["codesVersion", "purpose", "primaryFeatures", "targetUsers"],
    "Product overview",
  );
  assertCurrentCodes(value, codesVersion, "Product overview");
  const artifacts = collectArtifactIdentities(state);
  const problems = collectingProblems();

  const parseEntry = (
    entry: unknown,
    label: string,
    type: StructuralFragment,
  ): ProductOverviewPatchItem => {
    if (typeof entry === "string") return existingIdNamed(entry, type, artifacts, label);
    if (!isRecord(entry)) {
      throw new InvalidJsonError(`${label} must be a code or an object.`);
    }
    assertAllowedKeys(entry, ["item", "content"], label);
    const content = requiredString(entry, "content", label);
    const name = optionalString(entry, "item", label);
    return name === undefined
      ? { content }
      : { id: existingIdNamed(name, type, artifacts, label), content };
  };
  const parseList = (field: string, type: StructuralFragment): ProductOverviewPatchItem[] => {
    const raw = requiredArray(value, field, "Product overview");
    if (raw.length === 0) {
      throw new InvalidJsonError(`Product overview.${field} must not be empty.`);
    }
    const entries = raw.flatMap((entry, index) => {
      const parsed = problems.attempt(() => parseEntry(entry, `Product overview.${field}[${index}]`, type));
      return parsed === undefined ? [] : [parsed];
    });
    reportRepeatedItems(
      entries.flatMap((entry) => (typeof entry === "string" ? [entry] : entry.id === undefined ? [] : [entry.id])),
      artifacts,
      `Product overview.${field}`,
      problems.report,
    );
    return entries;
  };

  const purpose = problems.attempt(() => requiredString(value, "purpose", "Product overview"));
  const primaryFeatures = parseList("primaryFeatures", StructuralFragment.PrimaryFeature);
  const targetUsers = parseList("targetUsers", StructuralFragment.TargetUser);
  problems.throwIfAny();
  return { purpose: purpose!, primaryFeatures, targetUsers };
}

function collectList(
  value: unknown,
  type: StructuralFragment,
  target: Map<string, ArtifactIdentity>,
): void {
  if (!Array.isArray(value)) return;
  value.forEach((candidate, index) => {
    if (!isRecord(candidate) || typeof candidate.id !== "string") return;
    target.set(candidate.id, {
      id: candidate.id,
      code: formatCode(FRAGMENT_CODES[type], index + 1, value.length),
      type,
    });
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

function parseReferences(
  value: Record<string, unknown>,
  label: string,
  artifacts: Map<string, ArtifactIdentity>,
  definition: ArtifactStageDefinition,
): ArtifactProposalItem["references"] {
  const seen = new Set<string>();
  return requiredArray(value, "references", label).map((candidate) => {
    if (typeof candidate !== "string" || candidate.trim().length === 0) {
      throw new InvalidJsonError(`${label}.references must hold codes.`);
    }
    const identity = identityNamed(candidate, artifacts);
    if (identity == null) {
      throw new InvalidJsonError(`${label} references ${candidate}, which matches no item.`);
    }
    if (!definition.allowedReferenceTypes.includes(identity.type)) {
      throw new InvalidJsonError(`${label} references ${identity.code}, outside this stage's allowed scope.`);
    }
    if (seen.has(identity.id)) {
      throw new InvalidJsonError(`${label} references ${identity.code} twice.`);
    }
    seen.add(identity.id);
    return { id: identity.id, type: identity.type };
  });
}

/** How errors name an entry: by the code of the item it keeps or changes, or by its key. */
function entryLabel(
  entry: unknown,
  index: number,
  artifacts: Map<string, ArtifactIdentity>,
): string {
  const name = typeof entry === "string"
    ? entry
    : isRecord(entry) && typeof entry.item === "string" ? entry.item : undefined;
  if (name !== undefined) return identityNamed(name, artifacts)?.code ?? `Artifact result.items[${index}]`;
  if (isRecord(entry) && typeof entry.key === "string") return `New item "${entry.key}"`;
  return `Artifact result.items[${index}]`;
}

/**
 * One entry of a list result. An entry naming an existing item changes only
 * the fields it gives and keeps the rest from `kept`, that item as it stands.
 */
function parseArtifactItem(
  value: unknown,
  label: string,
  definition: ArtifactStageDefinition,
  artifacts: Map<string, ArtifactIdentity>,
  kept: (id: string) => ArtifactProposalItem,
): ArtifactProposalItem {
  if (typeof value === "string") {
    return kept(existingIdNamed(value, definition.entityType, artifacts, label));
  }
  if (!isRecord(value)) {
    throw new InvalidJsonError(`${label} must be a code or an object.`);
  }

  assertAllowedKeys(
    value,
    ["key", "item", "content", "priority", "references", "dependencies"],
    label,
  );

  const name = optionalString(value, "item", label);
  const id = name === undefined
    ? undefined
    : existingIdNamed(name, definition.entityType, artifacts, label);
  const existing = id === undefined ? undefined : kept(id);
  const given = (field: string) => existing == null || value[field] !== undefined;

  const key = given("key") ? requiredSingleLineString(value, "key", label) : existing!.key;
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(key) || key.length > 80) {
    throw new InvalidJsonError(
      `${label}.key must be 1-80 letters, numbers, underscores, or hyphens and start with a letter or number.`,
    );
  }
  let references = existing?.references ?? [];
  if (given("references")) {
    references = parseReferences(value, label, artifacts, definition);
    if (references.length === 0) {
      throw new InvalidJsonError(`${label}.references must not be empty.`);
    }
  }
  return {
    key,
    id,
    content: given("content") ? requiredString(value, "content", label) : existing!.content,
    priority: given("priority") ? enumValue(value.priority, Priority, `${label}.priority`) : existing!.priority,
    references,
    dependencies: given("dependencies") ? stringArray(value, "dependencies", label) : existing!.dependencies,
  };
}

/**
 * A dependency names a proposal key, or an item of the result by its code
 * or id whatever key its entry uses; each becomes that entry's key.
 */
function withDependencyKeys(
  items: ArtifactProposalItem[],
  artifacts: Map<string, ArtifactIdentity>,
): ArtifactProposalItem[] {
  const keys = new Set(items.map(({ key }) => key));
  const keyById = new Map(items.flatMap(({ id, key }) => (id === undefined ? [] : [[id, key] as const])));
  return items.map((item) => ({
    ...item,
    dependencies: item.dependencies.map((name) => {
      if (keys.has(name)) return name;
      const id = identityNamed(name, artifacts)?.id;
      return (id === undefined ? undefined : keyById.get(id)) ?? name;
    }),
  }));
}

function reportInvalidDependencies(
  items: ArtifactProposalItem[],
  labelOf: (key: string) => string,
  report: (problem: string) => void,
): void {
  const itemKeys = new Set(items.map(({ key }) => key));
  const dependenciesByKey = new Map<string, string[]>();

  items.forEach((item) => {
    const label = labelOf(item.key);
    const seen = new Set<string>();
    item.dependencies.forEach((dependency) => {
      if (seen.has(dependency)) {
        report(`${label} depends on ${labelOf(dependency)} twice.`);
      } else if (!itemKeys.has(dependency)) {
        report(`${label} depends on ${dependency}, which is no item of this result.`);
      } else if (item.key === dependency) {
        report(`${label} depends on itself.`);
      }
      seen.add(dependency);
    });
    dependenciesByKey.set(item.key, item.dependencies.filter((dependency) => itemKeys.has(dependency)));
  });

  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(key: string): void {
    if (visiting.has(key)) {
      report(`Dependencies form a cycle through ${labelOf(key)}.`);
      return;
    }
    if (visited.has(key)) return;
    visiting.add(key);
    (dependenciesByKey.get(key) ?? []).forEach(visit);
    visiting.delete(key);
    visited.add(key);
  }
  dependenciesByKey.forEach((_, key) => visit(key));
}

function reportMissingCoverage(
  items: ArtifactProposalItem[],
  artifacts: Map<string, ArtifactIdentity>,
  definition: ArtifactStageDefinition,
  report: (problem: string) => void,
): void {
  if (definition.coverageReferenceType == null) return;
  const required = [...artifacts.values()]
    .filter(({ type }) => type === definition.coverageReferenceType);
  const missing = new Set(uncoveredIds(
    required.map(({ id }) => id),
    items.flatMap((item) => item.references.map(({ id }) => id)),
  ));
  if (missing.size > 0) {
    const codes = required.filter(({ id }) => missing.has(id)).map(({ code }) => code);
    report(`${definition.entityType} result does not cover ${codes.join(", ")}.`);
  }
}

export function parseArtifactListProposal(
  value: unknown,
  {
    expectedEntityType,
    state,
    codesVersion,
  }: {
    expectedEntityType: StructuralFragment;
    state: Record<string, unknown>;
    codesVersion: string;
  },
): ArtifactListProposal {
  if (!isRecord(value)) {
    throw new InvalidJsonError("Artifact-list result must be an object.");
  }
  assertAllowedKeys(value, ["codesVersion", "items"], "Artifact result");
  assertCurrentCodes(value, codesVersion, "Artifact result");
  const entityType = expectedEntityType;
  const definition = getArtifactStageDefinition(entityType);
  const artifacts = collectArtifactIdentities(state);
  const rawItems = requiredArray(value, "items", "Artifact result");
  if (rawItems.length === 0) {
    throw new InvalidJsonError("Artifact result.items must not be empty.");
  }
  const getListForType = (): unknown[] => {
    const overview = isRecord(state.productOverview) ? state.productOverview : {};
    switch (entityType) {
      case StructuralFragment.PrimaryFeature:
        return Array.isArray(overview.primaryFeatures) ? (overview.primaryFeatures as unknown[]) : [];
      case StructuralFragment.TargetUser:
        return Array.isArray(overview.targetUsers) ? (overview.targetUsers as unknown[]) : [];
      case StructuralFragment.UserStory:
        return Array.isArray(state.userStories) ? (state.userStories as unknown[]) : [];
      case StructuralFragment.Requirement:
        return Array.isArray(state.requirements) ? (state.requirements as unknown[]) : [];
      case StructuralFragment.AcceptanceCriteria:
        return Array.isArray(state.acceptanceCriteria)
          ? (state.acceptanceCriteria as unknown[])
          : [];
      default:
        return [];
    }
  };
  const existingList = getListForType();
  const findExisting = (id: string): Record<string, unknown> | undefined =>
    existingList.find(
      (candidate) => isRecord(candidate) && candidate.id === id,
    ) as Record<string, unknown> | undefined;
  // An existing item as it stands: what a bare code keeps, and what a patch changes.
  const kept = (id: string): ArtifactProposalItem => {
    const existing = findExisting(id);
    if (existing == null) {
      throw new InvalidJsonError(`Artifact result names ${id}, which matches no existing ${entityType}.`);
    }
    return {
      key: id,
      id,
      content: typeof existing.content === "string" ? existing.content : "",
      priority:
        typeof existing.priority === "string" && isEnumMember(existing.priority, Priority)
          ? (existing.priority as Priority)
          : Priority.P1,
      references: Array.isArray(existing.references)
        ? (existing.references as ArtifactProposalItem["references"])
        : [],
      dependencies: Array.isArray(existing.dependencies) ? (existing.dependencies as string[]) : [],
    };
  };
  const problems = collectingProblems();
  const parsed = rawItems.flatMap((item, index) => {
    const label = entryLabel(item, index, artifacts);
    const entry = problems.attempt(() => parseArtifactItem(item, label, definition, artifacts, kept));
    return entry === undefined ? [] : [entry];
  });
  // Graph checks over a partial result would only report what the failed entries left out.
  problems.throwIfAny();
  const items = withDependencyKeys(parsed, artifacts);

  const labelOf = (key: string): string => {
    const item = items.find((candidate) => candidate.key === key);
    if (item == null) return key;
    return item.id === undefined ? `New item "${key}"` : artifacts.get(item.id)?.code ?? key;
  };
  reportRepeatedItems(
    items.flatMap((item) => (item.id === undefined ? [] : [item.id])),
    artifacts,
    "Artifact result",
    problems.report,
  );
  const keys = items.map(({ key }) => key);
  new Set(keys.filter((key, index) => keys.indexOf(key) !== index)).forEach((key) => {
    problems.report(`Artifact result uses the key ${key} more than once.`);
  });
  problems.throwIfAny();
  reportInvalidDependencies(items, labelOf, problems.report);
  reportMissingCoverage(items, artifacts, definition, problems.report);
  problems.throwIfAny();
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
  const allowedKeys = new Set<string>([...allowedTextFields, "priority", "remove"]);
  Object.keys(rawPatch).forEach((key) => {
    if (!allowedKeys.has(key)) {
      throw new InvalidJsonError(
        `Fragment revision.patch.${key} is not allowed for ${entityType}.`,
      );
    }
  });
  if (rawPatch.remove !== undefined) {
    if (rawPatch.remove !== true) {
      throw new InvalidJsonError("Fragment revision.patch.remove must be true when provided.");
    }
    if (Object.keys(rawPatch).length !== 1) {
      throw new InvalidJsonError(
        "Fragment revision.patch.remove cannot be combined with other fields.",
      );
    }
    return { entityType, id, patch: { remove: true } };
  }
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
    ["purpose", "language", "framework"],
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
  const contractRevision = (
    contract: Record<string, unknown>,
    label: string,
  ): string => requiredSingleLineString(contract, "revisionId", label);
  const interfaceRevisionIds = interfaceContracts.map((contract, index) =>
    contractRevision(
      contract,
      `Test-code request.contracts.interfaceContracts[${index}]`,
    ),
  );
  const subjectRevisionIds = subjectContracts.map((contract, index) =>
    contractRevision(
      contract,
      `Test-code request.contracts.subjectContracts[${index}]`,
    ),
  );
  const verificationRevisionIds = verificationContracts.map((contract, index) =>
    contractRevision(
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
