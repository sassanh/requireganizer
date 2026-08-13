import { Validator } from "@cfworker/json-schema";

import { InvalidJsonError, isRecord } from "lib/json";

import { fingerprint, sha256Text } from "./hash";
import type {
  AcceptanceCoverage,
  AdapterProgram,
  BehavioralCaseDefinition,
  BehavioralScenarioBinding,
  BehavioralTraceEvent,
  BoundaryDesign,
  BoundaryDesignProposal,
  ContractSuite,
  ContractSuiteProposal,
  HarnessBindingContract,
  ImplementationProfile,
  ImplementationProfileProposal,
  InterfaceContractBundle,
  InterfaceContractBundleProposal,
  JsonSchema,
  JsonValue,
  NormalizedInterfaceIndex,
  PortableMatcher,
  ProjectSetup,
  ProjectSetupProposal,
  SemanticInteraction,
  SubjectContractBundle,
  TestCaseDefinition,
  TestCaseListProposal,
  TestScenarioBinding,
  TestScenarioListProposal,
  VerificationContract,
  VerificationPlan,
} from "./types";

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const PROPOSAL_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const JSON_POINTER_PATTERN = /^(?:\/(?:[^~/]|~0|~1)*)*$/;
const MAX_SCHEMA_CHARACTERS = 64_000;
const MAX_SCHEMA_DEPTH = 20;
const MAX_SCHEMA_NODES = 1_000;
const MAX_SCHEMA_PROPERTIES = 200;
const MAX_PATTERN_LENGTH = 256;
export const UNIMPLEMENTED_BINDING_MARKER =
  "REQUIREGANIZER_UNIMPLEMENTED_BINDING";

const ALLOWED_SCHEMA_KEYWORDS = new Set([
  "$defs",
  "$ref",
  "additionalProperties",
  "allOf",
  "anyOf",
  "const",
  "contains",
  "default",
  "dependentRequired",
  "description",
  "else",
  "enum",
  "exclusiveMaximum",
  "exclusiveMinimum",
  "examples",
  "format",
  "if",
  "items",
  "maxContains",
  "maxItems",
  "maxLength",
  "maxProperties",
  "maximum",
  "minContains",
  "minItems",
  "minLength",
  "minProperties",
  "minimum",
  "multipleOf",
  "not",
  "oneOf",
  "pattern",
  "prefixItems",
  "properties",
  "propertyNames",
  "required",
  "title",
  "then",
  "type",
  "uniqueItems",
]);

const PROVIDER_SCHEMA_KEYWORDS = new Set([
  "additionalProperties",
  "allOf",
  "anyOf",
  "const",
  "description",
  "enum",
  "items",
  "maxItems",
  "maxLength",
  "maxProperties",
  "maximum",
  "minItems",
  "minLength",
  "minProperties",
  "minimum",
  "multipleOf",
  "oneOf",
  "pattern",
  "prefixItems",
  "properties",
  "required",
  "title",
  "type",
  "uniqueItems",
]);

function fail(message: string): never {
  throw new InvalidJsonError(message);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) fail(`${label} must be an object.`);
  return value;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) fail(`${label} must be an array.`);
  return value;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`${label} must be non-empty text.`);
  }
  return value.trim();
}

function optionalText(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return text(value, label);
}

function identifier(value: unknown, label: string): string {
  const result = text(value, label);
  if (!IDENTIFIER_PATTERN.test(result)) {
    fail(`${label} must be a stable identifier.`);
  }
  return result;
}

function proposalKey(value: unknown, label: string): string {
  const result = text(value, label);
  if (!PROPOSAL_KEY_PATTERN.test(result)) {
    fail(`${label} must use letters, numbers, underscores, or hyphens.`);
  }
  return result;
}

function enumValue<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
  label: string,
): Values[number] {
  if (typeof value !== "string" || !values.includes(value)) {
    fail(`${label} has an unsupported value.`);
  }
  return value as Values[number];
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") fail(`${label} must be true or false.`);
  return value;
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(`${label} must be a finite number.`);
  }
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  const result = finiteNumber(value, label);
  if (!Number.isInteger(result) || result < 1) {
    fail(`${label} must be a positive integer.`);
  }
  return result;
}

function stringArray(
  value: unknown,
  label: string,
  options: { identifiers?: boolean; allowEmpty?: boolean } = {},
): string[] {
  const values = array(value, label).map((item, index) =>
    options.identifiers
      ? identifier(item, `${label}[${index}]`)
      : text(item, `${label}[${index}]`),
  );
  if (!options.allowEmpty && values.length === 0) {
    fail(`${label} must contain at least one item.`);
  }
  if (new Set(values).size !== values.length) {
    fail(`${label} must not contain duplicates.`);
  }
  return values;
}

function nullableIdentifier(value: unknown, label: string): string | null {
  if (value === null) return null;
  return identifier(value, label);
}

function jsonValue(value: unknown, label: string): JsonValue {
  if (value === null || ["string", "boolean"].includes(typeof value)) {
    return value as JsonValue;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(`${label} contains a non-finite number.`);
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => jsonValue(item, `${label}[${index}]`));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        jsonValue(item, `${label}.${key}`),
      ]),
    );
  }
  fail(`${label} must be JSON-compatible.`);
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) {
    fail(`${label} contains unsupported field ${JSON.stringify(unexpected[0])}.`);
  }
}

function uniqueIds<T extends { id: string }>(items: readonly T[], label: string) {
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) fail(`${label} contains duplicate id ${item.id}.`);
    ids.add(item.id);
  }
  return ids;
}

function assertKnownIds(
  values: readonly string[],
  allowed: ReadonlySet<string>,
  label: string,
): void {
  for (const value of values) {
    if (!allowed.has(value)) fail(`${label} references unknown id ${value}.`);
  }
}

function isResourceSafePattern(pattern: string): boolean {
  if (pattern.length > MAX_PATTERN_LENGTH) return false;
  if (/\\[1-9]|\(\?<?[=!]/.test(pattern)) return false;
  if (/\([^)]*[+*][^)]*\)[+*{]/.test(pattern)) return false;
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

function localReferenceTarget(
  root: Record<string, unknown>,
  reference: string,
): unknown {
  if (reference === "#") return root;
  if (!reference.startsWith("#/")) {
    fail(`JSON Schema reference ${JSON.stringify(reference)} must be local.`);
  }
  let current: unknown = root;
  for (const token of reference
    .slice(2)
    .split("/")
    .map((item) => item.replaceAll("~1", "/").replaceAll("~0", "~"))) {
    if (!isRecord(current) || !(token in current)) {
      fail(`JSON Schema reference ${JSON.stringify(reference)} does not resolve.`);
    }
    current = current[token];
  }
  return current;
}

function schemaChildren(schema: Record<string, unknown>): unknown[] {
  const children: unknown[] = [];
  if (isRecord(schema.properties)) {
    children.push(...Object.values(schema.properties));
  }
  if (isRecord(schema.$defs)) {
    children.push(...Object.values(schema.$defs));
  }
  for (const keyword of [
    "items",
    "additionalProperties",
    "contains",
    "propertyNames",
    "not",
    "if",
    "then",
    "else",
  ]) {
    const child = schema[keyword];
    if (typeof child === "boolean" || isRecord(child)) children.push(child);
  }
  for (const keyword of ["allOf", "anyOf", "oneOf", "prefixItems"]) {
    const value = schema[keyword];
    if (Array.isArray(value)) children.push(...value);
  }
  return children;
}

function assertReferenceSafety(root: Record<string, unknown>, label: string): void {
  let traversals = 0;
  const follow = (
    node: unknown,
    referenceStack: ReadonlySet<string>,
    referenceDepth: number,
  ): void => {
    if (typeof node === "boolean") return;
    const schema = record(node, label);
    traversals += 1;
    if (traversals > 20_000) {
      fail(`${label} contains an excessive reference expansion.`);
    }
    if (typeof schema.$ref === "string") {
      if (referenceStack.has(schema.$ref)) {
        fail(`${label} contains a recursive reference cycle at ${schema.$ref}.`);
      }
      if (referenceDepth >= MAX_SCHEMA_DEPTH) {
        fail(`${label} contains an excessively deep reference chain.`);
      }
      follow(
        localReferenceTarget(root, schema.$ref),
        new Set([...referenceStack, schema.$ref]),
        referenceDepth + 1,
      );
    }
    for (const child of schemaChildren(schema)) {
      follow(child, referenceStack, referenceDepth);
    }
  };

  follow(root, new Set(), 0);
}

export function assertSafeJsonSchema(
  value: unknown,
  label = "JSON Schema",
): asserts value is JsonSchema {
  const serialized = JSON.stringify(value);
  if (serialized === undefined || serialized.length > MAX_SCHEMA_CHARACTERS) {
    fail(`${label} exceeds the ${MAX_SCHEMA_CHARACTERS}-character limit.`);
  }
  if (typeof value === "boolean") return;
  const root = record(value, label);
  let nodes = 0;

  const visit = (node: unknown, path: string, depth: number): void => {
    if (typeof node === "boolean") return;
    const schema = record(node, path);
    nodes += 1;
    if (nodes > MAX_SCHEMA_NODES) fail(`${label} contains too many schema nodes.`);
    if (depth > MAX_SCHEMA_DEPTH) fail(`${label} is nested too deeply.`);

    for (const key of Object.keys(schema)) {
      if (!ALLOWED_SCHEMA_KEYWORDS.has(key)) {
        fail(`${path} uses unsupported JSON Schema keyword ${JSON.stringify(key)}.`);
      }
    }

    if (schema.$ref !== undefined) {
      const reference = text(schema.$ref, `${path}.$ref`);
      localReferenceTarget(root, reference);
    }
    if (schema.pattern !== undefined) {
      const pattern = text(schema.pattern, `${path}.pattern`);
      if (!isResourceSafePattern(pattern)) {
        fail(`${path}.pattern is not resource-safe.`);
      }
    }
    if (schema.properties !== undefined) {
      const properties = record(schema.properties, `${path}.properties`);
      if (Object.keys(properties).length > MAX_SCHEMA_PROPERTIES) {
        fail(`${path}.properties contains too many fields.`);
      }
      for (const [key, child] of Object.entries(properties)) {
        visit(child, `${path}.properties.${key}`, depth + 1);
      }
    }
    if (schema.$defs !== undefined) {
      const definitions = record(schema.$defs, `${path}.$defs`);
      for (const [key, child] of Object.entries(definitions)) {
        visit(child, `${path}.$defs.${key}`, depth + 1);
      }
    }
    if (schema.items !== undefined) visit(schema.items, `${path}.items`, depth + 1);
    if (schema.contains !== undefined) {
      visit(schema.contains, `${path}.contains`, depth + 1);
    }
    if (schema.propertyNames !== undefined) {
      visit(schema.propertyNames, `${path}.propertyNames`, depth + 1);
    }
    if (schema.not !== undefined) visit(schema.not, `${path}.not`, depth + 1);
    for (const keyword of ["allOf", "anyOf", "oneOf", "prefixItems"] as const) {
      if (schema[keyword] === undefined) continue;
      array(schema[keyword], `${path}.${keyword}`).forEach((child, index) =>
        visit(child, `${path}.${keyword}[${index}]`, depth + 1),
      );
    }
    for (const keyword of ["if", "then", "else"] as const) {
      if (schema[keyword] !== undefined) {
        visit(schema[keyword], `${path}.${keyword}`, depth + 1);
      }
    }
  };

  visit(root, label, 0);
  assertReferenceSafety(root, label);
}

export function validateJsonSchemaInstance(
  schema: JsonSchema,
  value: unknown,
  label: string,
): void {
  assertSafeJsonSchema(schema, `${label} schema`);
  const result = new Validator(schema, "2020-12", false).validate(value);
  if (!result.valid) {
    const first = result.errors[0];
    const location = first?.instanceLocation || "/";
    fail(`${label} does not satisfy its schema at ${location}: ${first?.error ?? "invalid value"}`);
  }
}

const CAPTURE_REFERENCE_SCHEMA = {
  type: "object",
  required: ["$capture"],
  additionalProperties: false,
  properties: {
    $capture: { type: "string", minLength: 1 },
  },
} as const;

function allowCaptureReferences(schema: JsonSchema): JsonSchema {
  const transform = (node: JsonSchema): JsonSchema => {
    if (typeof node === "boolean") {
      return { anyOf: [CAPTURE_REFERENCE_SCHEMA, node] } as JsonSchema;
    }
    const body: Record<string, JsonValue | undefined> = {};
    let definitions: JsonValue | undefined;
    for (const [key, value] of Object.entries(node)) {
      if (key === "$defs" && isRecord(value)) {
        definitions = Object.fromEntries(
          Object.entries(value).map(([name, child]) => [
            name,
            transform(child as JsonSchema),
          ]),
        ) as JsonValue;
      } else if (key === "properties" && isRecord(value)) {
        body[key] = Object.fromEntries(
          Object.entries(value).map(([name, child]) => [
            name,
            transform(child as JsonSchema),
          ]),
        ) as JsonValue;
      } else if (
        ["items", "contains", "if", "then", "else"].includes(key) &&
        (typeof value === "boolean" || isRecord(value))
      ) {
        body[key] = transform(value as JsonSchema) as JsonValue;
      } else if (key === "additionalProperties" && isRecord(value)) {
        body[key] = transform(value as JsonSchema) as JsonValue;
      } else if (
        ["allOf", "anyOf", "oneOf", "prefixItems"].includes(key) &&
        Array.isArray(value)
      ) {
        body[key] = value.map((child) =>
          transform(child as JsonSchema),
        ) as JsonValue;
      } else {
        body[key] = value;
      }
    }
    return {
      ...(definitions === undefined ? {} : { $defs: definitions }),
      anyOf: [CAPTURE_REFERENCE_SCHEMA, body],
    } as JsonSchema;
  };
  return transform(schema);
}

function validateJsonSchemaTemplate(
  schema: JsonSchema,
  value: unknown,
  label: string,
): void {
  assertSafeJsonSchema(schema, `${label} schema`);
  const result = new Validator(
    allowCaptureReferences(schema),
    "2020-12",
    false,
  ).validate(value);
  if (!result.valid) {
    const first = result.errors[0];
    const location = first?.instanceLocation || "/";
    fail(
      `${label} does not satisfy its schema at ${location}: ${first?.error ?? "invalid value"}`,
    );
  }
}

function dereferenceSchema(
  schema: unknown,
  root: Record<string, unknown>,
  stack: ReadonlySet<string>,
): unknown {
  if (typeof schema === "boolean") return schema;
  const current = record(schema, "JSON Schema node");
  if (typeof current.$ref === "string") {
    if (stack.has(current.$ref)) return {};
    return dereferenceSchema(
      localReferenceTarget(root, current.$ref),
      root,
      new Set([...stack, current.$ref]),
    );
  }
  return Object.fromEntries(
    Object.entries(current)
      .filter(([key]) => PROVIDER_SCHEMA_KEYWORDS.has(key))
      .map(([key, item]) => {
        if (key === "properties" && isRecord(item)) {
          return [
            key,
            Object.fromEntries(
              Object.entries(item).map(([name, child]) => [
                name,
                dereferenceSchema(child, root, stack),
              ]),
            ),
          ];
        }
        if (["items", "additionalProperties"].includes(key)) {
          return [key, dereferenceSchema(item, root, stack)];
        }
        if (["allOf", "anyOf", "oneOf", "prefixItems"].includes(key)) {
          return [
            key,
            Array.isArray(item)
              ? item.map((child) => dereferenceSchema(child, root, stack))
              : item,
          ];
        }
        return [key, item];
      }),
  );
}

export function projectProviderSchema(schema: JsonSchema): Record<string, unknown> {
  assertSafeJsonSchema(schema, "Adapter tool schema");
  if (typeof schema === "boolean") return schema ? {} : { not: {} };
  return record(dereferenceSchema(schema, schema, new Set()), "Provider schema");
}

function parseSubject(value: unknown, label: string) {
  const item = record(value, label);
  exactKeys(
    item,
    [
      "id",
      "name",
      "purpose",
      "classification",
      "parentSubjectId",
      "responsibilities",
      "exclusions",
      "lifecycle",
      "requirementIds",
      "acceptanceCriteriaIds",
    ],
    label,
  );
  return {
    id: identifier(item.id, `${label}.id`),
    name: text(item.name, `${label}.name`),
    purpose: text(item.purpose, `${label}.purpose`),
    classification: enumValue(
      item.classification,
      ["external", "internal", "composite"] as const,
      `${label}.classification`,
    ),
    parentSubjectId: nullableIdentifier(
      item.parentSubjectId,
      `${label}.parentSubjectId`,
    ),
    responsibilities: stringArray(item.responsibilities, `${label}.responsibilities`),
    exclusions: stringArray(item.exclusions, `${label}.exclusions`, {
      allowEmpty: true,
    }),
    lifecycle: enumValue(
      item.lifecycle,
      ["fresh_per_case"] as const,
      `${label}.lifecycle`,
    ),
    requirementIds: stringArray(item.requirementIds, `${label}.requirementIds`, {
      identifiers: true,
      allowEmpty: true,
    }),
    acceptanceCriteriaIds: stringArray(
      item.acceptanceCriteriaIds,
      `${label}.acceptanceCriteriaIds`,
      { identifiers: true, allowEmpty: true },
    ),
  };
}

function parseInterface(value: unknown, label: string) {
  const item = record(value, label);
  exactKeys(
    item,
    [
      "id",
      "subjectId",
      "name",
      "peer",
      "visibility",
      "direction",
      "interactionStyle",
      "interactionIds",
    ],
    label,
  );
  return {
    id: identifier(item.id, `${label}.id`),
    subjectId: identifier(item.subjectId, `${label}.subjectId`),
    name: text(item.name, `${label}.name`),
    peer: text(item.peer, `${label}.peer`),
    visibility: enumValue(
      item.visibility,
      ["external", "internal"] as const,
      `${label}.visibility`,
    ),
    direction: enumValue(
      item.direction,
      ["inbound", "outbound", "bidirectional"] as const,
      `${label}.direction`,
    ),
    interactionStyle: enumValue(
      item.interactionStyle,
      [
        "request_response",
        "command",
        "query",
        "event",
        "stream",
        "interactive",
      ] as const,
      `${label}.interactionStyle`,
    ),
    interactionIds: stringArray(item.interactionIds, `${label}.interactionIds`, {
      identifiers: true,
    }),
  };
}

function parseInteraction(value: unknown, label: string): SemanticInteraction {
  const item = record(value, label);
  exactKeys(
    item,
    [
      "id",
      "interfaceId",
      "name",
      "intent",
      "inputDescription",
      "outputDescription",
      "failureDescriptions",
      "stateEffects",
      "requirementIds",
      "acceptanceCriteriaIds",
    ],
    label,
  );
  return {
    id: identifier(item.id, `${label}.id`),
    interfaceId: identifier(item.interfaceId, `${label}.interfaceId`),
    name: text(item.name, `${label}.name`),
    intent: text(item.intent, `${label}.intent`),
    inputDescription: text(item.inputDescription, `${label}.inputDescription`),
    outputDescription: text(item.outputDescription, `${label}.outputDescription`),
    failureDescriptions: stringArray(
      item.failureDescriptions,
      `${label}.failureDescriptions`,
      { allowEmpty: true },
    ),
    stateEffects: stringArray(item.stateEffects, `${label}.stateEffects`, {
      allowEmpty: true,
    }),
    requirementIds: stringArray(item.requirementIds, `${label}.requirementIds`, {
      identifiers: true,
      allowEmpty: true,
    }),
    acceptanceCriteriaIds: stringArray(
      item.acceptanceCriteriaIds,
      `${label}.acceptanceCriteriaIds`,
      { identifiers: true },
    ),
  };
}

function parseVerificationObligation(value: unknown, label: string) {
  const item = record(value, label);
  exactKeys(
    item,
    ["id", "name", "kind", "description", "requirementIds", "acceptanceCriteriaIds"],
    label,
  );
  return {
    id: identifier(item.id, `${label}.id`),
    name: text(item.name, `${label}.name`),
    kind: enumValue(
      item.kind,
      [
        "performance",
        "security",
        "accessibility",
        "compatibility",
        "static_analysis",
        "manual_evidence",
      ] as const,
      `${label}.kind`,
    ),
    description: text(item.description, `${label}.description`),
    requirementIds: stringArray(item.requirementIds, `${label}.requirementIds`, {
      identifiers: true,
      allowEmpty: true,
    }),
    acceptanceCriteriaIds: stringArray(
      item.acceptanceCriteriaIds,
      `${label}.acceptanceCriteriaIds`,
      { identifiers: true },
    ),
  };
}

function parseCoverage(value: unknown, label: string): AcceptanceCoverage {
  const item = record(value, label);
  exactKeys(item, ["acceptanceCriteriaId", "targetType", "targetId"], label);
  return {
    acceptanceCriteriaId: identifier(
      item.acceptanceCriteriaId,
      `${label}.acceptanceCriteriaId`,
    ),
    targetType: enumValue(
      item.targetType,
      ["interaction", "verification_obligation"] as const,
      `${label}.targetType`,
    ),
    targetId: identifier(item.targetId, `${label}.targetId`),
  };
}

export function parseBoundaryDesignProposal(value: unknown): BoundaryDesignProposal {
  const proposal = record(value, "Boundary design");
  exactKeys(
    proposal,
    [
      "rootSubjectId",
      "subjects",
      "interfaces",
      "interactions",
      "verificationObligations",
      "coverage",
    ],
    "Boundary design",
  );
  return {
    rootSubjectId: identifier(proposal.rootSubjectId, "Boundary design.rootSubjectId"),
    subjects: array(proposal.subjects, "Boundary design.subjects").map((item, index) =>
      parseSubject(item, `Boundary design.subjects[${index}]`),
    ),
    interfaces: array(proposal.interfaces, "Boundary design.interfaces").map(
      (item, index) => parseInterface(item, `Boundary design.interfaces[${index}]`),
    ),
    interactions: array(proposal.interactions, "Boundary design.interactions").map(
      (item, index) =>
        parseInteraction(item, `Boundary design.interactions[${index}]`),
    ),
    verificationObligations: array(
      proposal.verificationObligations,
      "Boundary design.verificationObligations",
    ).map((item, index) =>
      parseVerificationObligation(
        item,
        `Boundary design.verificationObligations[${index}]`,
      ),
    ),
    coverage: array(proposal.coverage, "Boundary design.coverage").map(
      (item, index) => parseCoverage(item, `Boundary design.coverage[${index}]`),
    ),
  };
}

export function validateBoundaryDesign(
  design: BoundaryDesign | BoundaryDesignProposal,
  context: {
    requirementIds: ReadonlySet<string>;
    acceptanceCriteriaIds: ReadonlySet<string>;
    requirementsRevisionId?: string;
    acceptanceCriteriaRevisionId?: string;
  },
): void {
  if (
    "requirementsRevisionId" in design &&
    context.requirementsRevisionId !== undefined &&
    design.requirementsRevisionId !== context.requirementsRevisionId
  ) {
    fail("Boundary design is bound to a stale requirements revision.");
  }
  if (
    "acceptanceCriteriaRevisionId" in design &&
    context.acceptanceCriteriaRevisionId !== undefined &&
    design.acceptanceCriteriaRevisionId !== context.acceptanceCriteriaRevisionId
  ) {
    fail("Boundary design is bound to a stale acceptance-criteria revision.");
  }
  const subjectIds = uniqueIds(design.subjects, "Boundary design subjects");
  const interfaceIds = uniqueIds(design.interfaces, "Boundary design interfaces");
  const interactionIds = uniqueIds(
    design.interactions,
    "Boundary design interactions",
  );
  const obligationIds = uniqueIds(
    design.verificationObligations,
    "Boundary design verification obligations",
  );
  const root = design.subjects.find(({ id }) => id === design.rootSubjectId);
  if (root == null) fail("Boundary design rootSubjectId must identify a subject.");
  if (root.parentSubjectId !== null) fail("The root subject cannot have a parent.");
  if (root.classification === "internal") {
    fail("The root product subject cannot be classified as internal.");
  }

  for (const subject of design.subjects) {
    assertKnownIds(subject.requirementIds, context.requirementIds, `${subject.id}.requirementIds`);
    assertKnownIds(
      subject.acceptanceCriteriaIds,
      context.acceptanceCriteriaIds,
      `${subject.id}.acceptanceCriteriaIds`,
    );
    if (subject.id !== root.id) {
      if (subject.parentSubjectId == null || !subjectIds.has(subject.parentSubjectId)) {
        fail(`Subject ${subject.id} must have an existing parent subject.`);
      }
      if (
        subject.classification === "internal" &&
        subject.requirementIds.length === 0 &&
        subject.acceptanceCriteriaIds.length === 0
      ) {
        fail(`Internal subject ${subject.id} is not justified by an upstream artifact.`);
      }
    }
    const ancestors = new Set([subject.id]);
    let parentId = subject.parentSubjectId;
    while (parentId != null) {
      if (ancestors.has(parentId)) fail(`Subject ${subject.id} has a parent cycle.`);
      ancestors.add(parentId);
      parentId = design.subjects.find(({ id }) => id === parentId)?.parentSubjectId ?? null;
    }
  }

  for (const semanticInterface of design.interfaces) {
    if (!subjectIds.has(semanticInterface.subjectId)) {
      fail(`Interface ${semanticInterface.id} references an unknown subject.`);
    }
    assertKnownIds(
      semanticInterface.interactionIds,
      interactionIds,
      `Interface ${semanticInterface.id}.interactionIds`,
    );
    const owned = design.interactions
      .filter(({ interfaceId }) => interfaceId === semanticInterface.id)
      .map(({ id }) => id);
    if (
      owned.length !== semanticInterface.interactionIds.length ||
      owned.some((id) => !semanticInterface.interactionIds.includes(id))
    ) {
      fail(`Interface ${semanticInterface.id} must list exactly its owned interactions.`);
    }
  }

  for (const interaction of design.interactions) {
    if (!interfaceIds.has(interaction.interfaceId)) {
      fail(`Interaction ${interaction.id} references an unknown interface.`);
    }
    assertKnownIds(
      interaction.requirementIds,
      context.requirementIds,
      `Interaction ${interaction.id}.requirementIds`,
    );
    assertKnownIds(
      interaction.acceptanceCriteriaIds,
      context.acceptanceCriteriaIds,
      `Interaction ${interaction.id}.acceptanceCriteriaIds`,
    );
  }
  for (const obligation of design.verificationObligations) {
    assertKnownIds(
      obligation.requirementIds,
      context.requirementIds,
      `Verification obligation ${obligation.id}.requirementIds`,
    );
    assertKnownIds(
      obligation.acceptanceCriteriaIds,
      context.acceptanceCriteriaIds,
      `Verification obligation ${obligation.id}.acceptanceCriteriaIds`,
    );
  }

  const coveredCriteria = new Set<string>();
  for (const coverage of design.coverage) {
    if (!context.acceptanceCriteriaIds.has(coverage.acceptanceCriteriaId)) {
      fail(`Coverage references unknown acceptance criterion ${coverage.acceptanceCriteriaId}.`);
    }
    const targets =
      coverage.targetType === "interaction" ? interactionIds : obligationIds;
    if (!targets.has(coverage.targetId)) {
      fail(`Coverage references unknown ${coverage.targetType} ${coverage.targetId}.`);
    }
    const targetCriteria =
      coverage.targetType === "interaction"
        ? design.interactions.find(({ id }) => id === coverage.targetId)
            ?.acceptanceCriteriaIds
        : design.verificationObligations.find(({ id }) => id === coverage.targetId)
            ?.acceptanceCriteriaIds;
    if (!targetCriteria?.includes(coverage.acceptanceCriteriaId)) {
      fail(`Coverage target ${coverage.targetId} does not claim criterion ${coverage.acceptanceCriteriaId}.`);
    }
    coveredCriteria.add(coverage.acceptanceCriteriaId);
  }
  for (const criterionId of context.acceptanceCriteriaIds) {
    if (!coveredCriteria.has(criterionId)) {
      fail(`Acceptance criterion ${criterionId} has no verification coverage.`);
    }
  }
}

export function parseImplementationProfileProposal(
  value: unknown,
): ImplementationProfileProposal {
  const profile = record(value, "Implementation profile");
  exactKeys(
    profile,
    [
      "platform",
      "runtime",
      "language",
      "framework",
      "moduleSystem",
      "buildEcosystem",
      "testEcosystem",
      "constraints",
    ],
    "Implementation profile",
  );
  const result = {
    platform: text(profile.platform, "Implementation profile.platform"),
    runtime: text(profile.runtime, "Implementation profile.runtime"),
    language: text(profile.language, "Implementation profile.language"),
    framework: text(profile.framework, "Implementation profile.framework"),
    moduleSystem: text(profile.moduleSystem, "Implementation profile.moduleSystem"),
    buildEcosystem: text(
      profile.buildEcosystem,
      "Implementation profile.buildEcosystem",
    ),
    testEcosystem: text(
      profile.testEcosystem,
      "Implementation profile.testEcosystem",
    ),
    constraints: stringArray(profile.constraints, "Implementation profile.constraints", {
      allowEmpty: true,
    }),
  };
  validateImplementationProfile(result);
  return result;
}

export function validateImplementationProfile(
  profile: ImplementationProfile | ImplementationProfileProposal,
  boundaryRevisionId?: string,
): void {
  for (const field of [
    "platform",
    "runtime",
    "language",
    "framework",
    "moduleSystem",
    "buildEcosystem",
    "testEcosystem",
  ] as const) {
    text(profile[field], `Implementation profile.${field}`);
  }
  stringArray(profile.constraints, "Implementation profile.constraints", {
    allowEmpty: true,
  });
  if (
    boundaryRevisionId !== undefined &&
    "boundaryRevisionId" in profile &&
    profile.boundaryRevisionId !== boundaryRevisionId
  ) {
    fail("Implementation profile is bound to a stale boundary-design revision.");
  }
}

function schema(value: unknown, label: string): JsonSchema {
  const parsed = jsonValue(value, label) as JsonSchema;
  assertSafeJsonSchema(parsed, label);
  return parsed;
}

function parseAdapter(value: unknown, label: string): AdapterProgram {
  const adapter = record(value, label);
  exactKeys(
    adapter,
    [
      "id",
      "version",
      "notation",
      "rationale",
      "formalizationInstructions",
      "revisionInstructions",
      "toolSchemas",
    ],
    label,
  );
  const tools = record(adapter.toolSchemas, `${label}.toolSchemas`);
  exactKeys(tools, ["formalContract", "traceEvent"], `${label}.toolSchemas`);
  const formalContractSchema = schema(
    tools.formalContract,
    `${label}.toolSchemas.formalContract`,
  );
  const traceEventSchema = schema(
    tools.traceEvent,
    `${label}.toolSchemas.traceEvent`,
  );
  if (
    typeof formalContractSchema === "boolean" ||
    typeof traceEventSchema === "boolean"
  ) {
    fail(`${label}.toolSchemas must define object schemas, not booleans.`);
  }
  return {
    id: identifier(adapter.id, `${label}.id`),
    version: text(adapter.version, `${label}.version`),
    notation: text(adapter.notation, `${label}.notation`),
    rationale: text(adapter.rationale, `${label}.rationale`),
    formalizationInstructions: stringArray(
      adapter.formalizationInstructions,
      `${label}.formalizationInstructions`,
    ),
    revisionInstructions: stringArray(
      adapter.revisionInstructions,
      `${label}.revisionInstructions`,
    ),
    toolSchemas: {
      formalContract: formalContractSchema,
      traceEvent: traceEventSchema,
    },
  };
}

function safeVirtualPath(value: unknown, label: string): string {
  const path = text(value, label);
  if (
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((part) => part === "" || part === "." || part === "..") ||
    /[\u0000-\u001f]/.test(path)
  ) {
    fail(`${label} must be a safe relative POSIX path.`);
  }
  return path;
}

function parseNormalizedIndex(
  value: unknown,
  label: string,
): NormalizedInterfaceIndex {
  const index = record(value, label);
  exactKeys(index, ["interfaceId", "interactions"], label);
  return {
    interfaceId: identifier(index.interfaceId, `${label}.interfaceId`),
    interactions: array(index.interactions, `${label}.interactions`).map(
      (candidate, interactionIndex) => {
        const itemLabel = `${label}.interactions[${interactionIndex}]`;
        const item = record(candidate, itemLabel);
        exactKeys(
          item,
          [
            "semanticInteractionId",
            "operationId",
            "inputSchema",
            "outputs",
            "errors",
            "nativeAnchors",
          ],
          itemLabel,
        );
        const parseOutcome = (outcome: unknown, outcomeLabel: string) => {
          const result = record(outcome, outcomeLabel);
          exactKeys(result, ["id", "description", "schema"], outcomeLabel);
          return {
            id: identifier(result.id, `${outcomeLabel}.id`),
            description: text(result.description, `${outcomeLabel}.description`),
            schema: schema(result.schema, `${outcomeLabel}.schema`),
          };
        };
        return {
          semanticInteractionId: identifier(
            item.semanticInteractionId,
            `${itemLabel}.semanticInteractionId`,
          ),
          operationId: identifier(item.operationId, `${itemLabel}.operationId`),
          inputSchema: schema(item.inputSchema, `${itemLabel}.inputSchema`),
          outputs: array(item.outputs, `${itemLabel}.outputs`).map((outcome, index_) =>
            parseOutcome(outcome, `${itemLabel}.outputs[${index_}]`),
          ),
          errors: array(item.errors, `${itemLabel}.errors`).map((outcome, index_) =>
            parseOutcome(outcome, `${itemLabel}.errors[${index_}]`),
          ),
          nativeAnchors: stringArray(item.nativeAnchors, `${itemLabel}.nativeAnchors`),
        };
      },
    ),
  };
}

function parseInterfaceContractProposal(
  value: unknown,
  label: string,
): InterfaceContractBundleProposal {
  const bundle = record(value, label);
  exactKeys(bundle, ["interfaceId", "adapter", "formalContract", "normalizedIndex"], label);
  const formal = record(bundle.formalContract, `${label}.formalContract`);
  exactKeys(
    formal,
    ["format", "summary", "documents", "neutralManifest"],
    `${label}.formalContract`,
  );
  return {
    interfaceId: identifier(bundle.interfaceId, `${label}.interfaceId`),
    adapter: parseAdapter(bundle.adapter, `${label}.adapter`),
    formalContract: {
      format: text(formal.format, `${label}.formalContract.format`),
      summary: text(formal.summary, `${label}.formalContract.summary`),
      documents: array(formal.documents, `${label}.formalContract.documents`).map(
        (document, index) => {
          const documentLabel = `${label}.formalContract.documents[${index}]`;
          const item = record(document, documentLabel);
          exactKeys(item, ["path", "mediaType", "content", "sha256"], documentLabel);
          const content = typeof item.content === "string"
            ? item.content
            : fail(`${documentLabel}.content must be text.`);
          return {
            path: safeVirtualPath(item.path, `${documentLabel}.path`),
            mediaType: text(item.mediaType, `${documentLabel}.mediaType`),
            content,
            ...(item.sha256 === undefined
              ? {}
              : { sha256: text(item.sha256, `${documentLabel}.sha256`) }),
          };
        },
      ),
      neutralManifest:
        formal.neutralManifest === null
          ? null
          : jsonValue(formal.neutralManifest, `${label}.formalContract.neutralManifest`),
    },
    normalizedIndex: parseNormalizedIndex(
      bundle.normalizedIndex,
      `${label}.normalizedIndex`,
    ),
  };
}

function parseHarnessBinding(value: unknown, label: string): HarnessBindingContract {
  const harness = record(value, label);
  exactKeys(
    harness,
    [
      "moduleSpecifier",
      "subjectType",
      "factoryKind",
      "freshInstance",
      "resetStrategy",
      "fixtureSchema",
      "interactions",
    ],
    label,
  );
  return {
    moduleSpecifier: text(harness.moduleSpecifier, `${label}.moduleSpecifier`),
    subjectType: text(harness.subjectType, `${label}.subjectType`),
    factoryKind: enumValue(
      harness.factoryKind,
      ["constructor", "factory", "endpoint", "command", "fixture"] as const,
      `${label}.factoryKind`,
    ),
    freshInstance: text(harness.freshInstance, `${label}.freshInstance`),
    resetStrategy: text(harness.resetStrategy, `${label}.resetStrategy`),
    fixtureSchema: schema(harness.fixtureSchema, `${label}.fixtureSchema`),
    interactions: array(harness.interactions, `${label}.interactions`).map(
      (candidate, index) => {
        const itemLabel = `${label}.interactions[${index}]`;
        const item = record(candidate, itemLabel);
        exactKeys(item, ["interactionId", "invoke", "observe"], itemLabel);
        return {
          interactionId: identifier(item.interactionId, `${itemLabel}.interactionId`),
          invoke: text(item.invoke, `${itemLabel}.invoke`),
          observe: text(item.observe, `${itemLabel}.observe`),
        };
      },
    ),
  };
}

function parsePortableMatcher(value: unknown, label: string): PortableMatcher {
  const matcher = record(value, label);
  const kind = enumValue(
    matcher.kind,
    ["exact", "schema", "presence", "subset", "range", "regex", "unordered_list"] as const,
    `${label}.kind`,
  );
  switch (kind) {
    case "exact":
      exactKeys(matcher, ["kind", "value"], label);
      return { kind, value: jsonValue(matcher.value, `${label}.value`) };
    case "schema":
      exactKeys(matcher, ["kind"], label);
      return { kind };
    case "presence":
      exactKeys(matcher, ["kind", "pointer", "present"], label);
      return {
        kind,
        pointer: parsePointer(matcher.pointer, `${label}.pointer`),
        present: booleanValue(matcher.present, `${label}.present`),
      };
    case "subset":
      exactKeys(matcher, ["kind", "value"], label);
      return { kind, value: jsonValue(matcher.value, `${label}.value`) };
    case "range": {
      exactKeys(matcher, ["kind", "pointer", "minimum", "maximum"], label);
      const minimum = matcher.minimum === undefined
        ? undefined
        : finiteNumber(matcher.minimum, `${label}.minimum`);
      const maximum = matcher.maximum === undefined
        ? undefined
        : finiteNumber(matcher.maximum, `${label}.maximum`);
      if (minimum === undefined && maximum === undefined) {
        fail(`${label} must define minimum or maximum.`);
      }
      if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
        fail(`${label}.minimum cannot exceed maximum.`);
      }
      return {
        kind,
        pointer: parsePointer(matcher.pointer, `${label}.pointer`),
        ...(minimum === undefined ? {} : { minimum }),
        ...(maximum === undefined ? {} : { maximum }),
      };
    }
    case "regex": {
      exactKeys(matcher, ["kind", "pointer", "pattern"], label);
      const pattern = text(matcher.pattern, `${label}.pattern`);
      if (!isResourceSafePattern(pattern)) fail(`${label}.pattern is not resource-safe.`);
      return {
        kind,
        pointer: parsePointer(matcher.pointer, `${label}.pointer`),
        pattern,
      };
    }
    case "unordered_list":
      exactKeys(matcher, ["kind", "pointer", "items"], label);
      return {
        kind,
        pointer: parsePointer(matcher.pointer, `${label}.pointer`),
        items: array(matcher.items, `${label}.items`).map((item, index) =>
          jsonValue(item, `${label}.items[${index}]`),
        ),
      };
  }
}

function parsePointer(value: unknown, label: string): string {
  if (typeof value !== "string" || !JSON_POINTER_PATTERN.test(value)) {
    fail(`${label} must be a JSON Pointer.`);
  }
  return value;
}

export function parseContractSuiteProposal(value: unknown): ContractSuiteProposal {
  const suite = record(value, "Contract suite");
  exactKeys(
    suite,
    ["interfaceContracts", "subjectContracts", "verificationContracts"],
    "Contract suite",
  );
  return {
    interfaceContracts: array(
      suite.interfaceContracts,
      "Contract suite.interfaceContracts",
    ).map((item, index) =>
      parseInterfaceContractProposal(item, `Contract suite.interfaceContracts[${index}]`),
    ),
    subjectContracts: array(
      suite.subjectContracts,
      "Contract suite.subjectContracts",
    ).map((candidate, index) => {
      const label = `Contract suite.subjectContracts[${index}]`;
      const item = record(candidate, label);
      exactKeys(item, ["subjectId", "interfaceIds", "protocol", "harness"], label);
      const protocol = record(item.protocol, `${label}.protocol`);
      exactKeys(
        protocol,
        ["initialState", "states", "transitions", "orderingRules"],
        `${label}.protocol`,
      );
      return {
        subjectId: identifier(item.subjectId, `${label}.subjectId`),
        interfaceIds: stringArray(item.interfaceIds, `${label}.interfaceIds`, {
          identifiers: true,
          allowEmpty: true,
        }),
        protocol: {
          initialState: identifier(protocol.initialState, `${label}.protocol.initialState`),
          states: stringArray(protocol.states, `${label}.protocol.states`, {
            identifiers: true,
          }),
          transitions: array(protocol.transitions, `${label}.protocol.transitions`).map(
            (candidateTransition, transitionIndex) => {
              const transitionLabel = `${label}.protocol.transitions[${transitionIndex}]`;
              const transition = record(candidateTransition, transitionLabel);
              exactKeys(
                transition,
                ["id", "fromState", "interactionId", "outcomeId", "toState", "description"],
                transitionLabel,
              );
              return {
                id: identifier(transition.id, `${transitionLabel}.id`),
                fromState: identifier(transition.fromState, `${transitionLabel}.fromState`),
                interactionId: identifier(
                  transition.interactionId,
                  `${transitionLabel}.interactionId`,
                ),
                outcomeId: identifier(transition.outcomeId, `${transitionLabel}.outcomeId`),
                toState: identifier(transition.toState, `${transitionLabel}.toState`),
                description: text(transition.description, `${transitionLabel}.description`),
              };
            },
          ),
          orderingRules: stringArray(
            protocol.orderingRules,
            `${label}.protocol.orderingRules`,
            { allowEmpty: true },
          ),
        },
        harness: parseHarnessBinding(item.harness, `${label}.harness`),
      };
    }),
    verificationContracts: array(
      suite.verificationContracts,
      "Contract suite.verificationContracts",
    ).map((candidate, index) => {
      const label = `Contract suite.verificationContracts[${index}]`;
      const item = record(candidate, label);
      exactKeys(
        item,
        ["verificationObligationId", "environment", "stimulus", "evidenceSchema", "passMatchers"],
        label,
      );
      return {
        verificationObligationId: identifier(
          item.verificationObligationId,
          `${label}.verificationObligationId`,
        ),
        environment: stringArray(item.environment, `${label}.environment`),
        stimulus: stringArray(item.stimulus, `${label}.stimulus`),
        evidenceSchema: schema(item.evidenceSchema, `${label}.evidenceSchema`),
        passMatchers: array(item.passMatchers, `${label}.passMatchers`).map(
          (matcher, matcherIndex) =>
            parsePortableMatcher(matcher, `${label}.passMatchers[${matcherIndex}]`),
        ),
      };
    }),
  };
}

export function validateContractSuiteProposal(
  proposal: ContractSuiteProposal,
  design: BoundaryDesign,
  profileRevisionId: string,
): void {
  const createdAt = "1970-01-01T00:00:00.000Z";
  const interfaceContracts: InterfaceContractBundle[] =
    proposal.interfaceContracts.map((candidate) => ({
      id: `proposal-interface-${candidate.interfaceId}`,
      revisionId: `proposal-interface-revision-${candidate.interfaceId}`,
      revision: 1,
      status: "draft",
      createdAt,
      interfaceId: candidate.interfaceId,
      boundaryRevisionId: design.revisionId,
      profileRevisionId,
      adapter: candidate.adapter,
      formalContract: {
        ...candidate.formalContract,
        documents: candidate.formalContract.documents.map((document) => ({
          path: document.path,
          mediaType: document.mediaType,
          content: document.content,
          sha256: sha256Text(document.content),
        })),
      },
      normalizedIndex: candidate.normalizedIndex,
    }));
  const subjectContracts: SubjectContractBundle[] = proposal.subjectContracts.map(
    (candidate) => ({
      id: `proposal-subject-${candidate.subjectId}`,
      revisionId: `proposal-subject-revision-${candidate.subjectId}`,
      revision: 1,
      status: "draft",
      createdAt,
      subjectId: candidate.subjectId,
      boundaryRevisionId: design.revisionId,
      profileRevisionId,
      interfaceContractRevisionIds: candidate.interfaceIds.map(
        (interfaceId) =>
          interfaceContracts.find(
            (contract) => contract.interfaceId === interfaceId,
          )?.revisionId ?? `missing-interface-revision-${interfaceId}`,
      ),
      protocol: candidate.protocol,
      harness: candidate.harness,
    }),
  );
  const verificationContracts: VerificationContract[] =
    proposal.verificationContracts.map((candidate) => ({
      id: `proposal-verification-${candidate.verificationObligationId}`,
      revisionId: `proposal-verification-revision-${candidate.verificationObligationId}`,
      revision: 1,
      status: "draft",
      createdAt,
      verificationObligationId: candidate.verificationObligationId,
      boundaryRevisionId: design.revisionId,
      profileRevisionId,
      environment: candidate.environment,
      stimulus: candidate.stimulus,
      evidenceSchema: candidate.evidenceSchema,
      passMatchers: candidate.passMatchers,
    }));
  validateContractSuite(
    {
      id: "proposal-suite",
      revisionId: "proposal-suite-revision",
      revision: 1,
      createdAt,
      boundaryRevisionId: design.revisionId,
      profileRevisionId,
      interfaceContracts,
      subjectContracts,
      verificationContracts,
    },
    design,
    profileRevisionId,
  );
}

function interfaceInteractionIds(
  design: BoundaryDesign,
  interfaceId: string,
): Set<string> {
  return new Set(
    design.interactions
      .filter((interaction) => interaction.interfaceId === interfaceId)
      .map(({ id }) => id),
  );
}

export function validateContractSuite(
  suite: ContractSuite,
  design: BoundaryDesign,
  profileRevisionId: string,
): void {
  if (suite.boundaryRevisionId !== design.revisionId) {
    fail("Contract suite is bound to a different boundary revision.");
  }
  if (suite.profileRevisionId !== profileRevisionId) {
    fail("Contract suite is bound to a different implementation profile revision.");
  }
  const expectedInterfaces = new Set(design.interfaces.map(({ id }) => id));
  const actualInterfaces = new Set(suite.interfaceContracts.map(({ interfaceId }) => interfaceId));
  if (
    suite.interfaceContracts.length !== expectedInterfaces.size ||
    expectedInterfaces.size !== actualInterfaces.size ||
    [...expectedInterfaces].some((id) => !actualInterfaces.has(id))
  ) {
    fail("Contract suite must contain exactly one bundle for every semantic interface.");
  }
  uniqueIds(suite.interfaceContracts, "Interface contract bundles");
  uniqueIds(
    suite.interfaceContracts.map((bundle) => ({ id: bundle.adapter.id })),
    "Adapter programs",
  );

  for (const bundle of suite.interfaceContracts) {
    validateInterfaceContractBundle(bundle, design, profileRevisionId);
  }

  const expectedSubjects = new Set(design.subjects.map(({ id }) => id));
  const actualSubjects = new Set(suite.subjectContracts.map(({ subjectId }) => subjectId));
  if (
    suite.subjectContracts.length !== expectedSubjects.size ||
    expectedSubjects.size !== actualSubjects.size ||
    [...expectedSubjects].some((id) => !actualSubjects.has(id))
  ) {
    fail("Contract suite must contain exactly one protocol and harness binding per subject.");
  }
  uniqueIds(suite.subjectContracts, "Subject contract bundles");
  for (const bundle of suite.subjectContracts) {
    validateSubjectContractBundle(
      bundle,
      design,
      suite.interfaceContracts,
      profileRevisionId,
    );
  }

  const expectedObligations = new Set(
    design.verificationObligations.map(({ id }) => id),
  );
  const actualObligations = new Set(
    suite.verificationContracts.map(({ verificationObligationId }) => verificationObligationId),
  );
  if (
    suite.verificationContracts.length !== expectedObligations.size ||
    expectedObligations.size !== actualObligations.size ||
    [...expectedObligations].some((id) => !actualObligations.has(id))
  ) {
    fail("Contract suite must contain exactly one formal contract per verification obligation.");
  }
  uniqueIds(suite.verificationContracts, "Verification contract bundles");
  for (const contract of suite.verificationContracts) {
    validateVerificationContract(contract, design, profileRevisionId);
  }
}

export function validateInterfaceContractBundle(
  bundle: InterfaceContractBundle,
  design: BoundaryDesign,
  profileRevisionId: string,
): void {
  if (!design.interfaces.some(({ id }) => id === bundle.interfaceId)) {
    fail(`Interface contract ${bundle.id} references an unknown interface.`);
  }
  if (bundle.boundaryRevisionId !== design.revisionId) {
    fail(`Interface contract ${bundle.id} is bound to the wrong boundary revision.`);
  }
  if (bundle.profileRevisionId !== profileRevisionId) {
    fail(`Interface contract ${bundle.id} is bound to the wrong profile revision.`);
  }
  if (bundle.normalizedIndex.interfaceId !== bundle.interfaceId) {
    fail(`Interface contract ${bundle.id} has a mismatched normalized index.`);
  }
  assertSafeJsonSchema(bundle.adapter.toolSchemas.formalContract, `${bundle.id} formal tool schema`);
  assertSafeJsonSchema(bundle.adapter.toolSchemas.traceEvent, `${bundle.id} trace tool schema`);
  validateJsonSchemaInstance(
    bundle.adapter.toolSchemas.formalContract,
    bundle.formalContract,
    `${bundle.id} formal contract`,
  );
  const expectedInteractionIds = interfaceInteractionIds(design, bundle.interfaceId);
  const actualInteractionIds = new Set(
    bundle.normalizedIndex.interactions.map(({ semanticInteractionId }) => semanticInteractionId),
  );
  if (
    bundle.normalizedIndex.interactions.length !== expectedInteractionIds.size ||
    expectedInteractionIds.size !== actualInteractionIds.size ||
    [...expectedInteractionIds].some((id) => !actualInteractionIds.has(id))
  ) {
    fail(`Interface contract ${bundle.id} must normalize every semantic interaction exactly once.`);
  }
  const operationIds = new Set<string>();
  for (const interaction of bundle.normalizedIndex.interactions) {
    if (operationIds.has(interaction.operationId)) {
      fail(`Interface contract ${bundle.id} contains duplicate operation id ${interaction.operationId}.`);
    }
    operationIds.add(interaction.operationId);
    if (interaction.outputs.length === 0) {
      fail(`Normalized interaction ${interaction.operationId} must declare an output.`);
    }
    uniqueIds(interaction.outputs, `${interaction.operationId} outputs`);
    uniqueIds(interaction.errors, `${interaction.operationId} errors`);
    if (interaction.nativeAnchors.length === 0) {
      fail(`Normalized interaction ${interaction.operationId} must map to a native anchor.`);
    }
  }
  const documentPaths = new Set<string>();
  for (const document of bundle.formalContract.documents) {
    safeVirtualPath(document.path, `${bundle.id} document path`);
    if (documentPaths.has(document.path)) {
      fail(`Interface contract ${bundle.id} contains duplicate document path ${document.path}.`);
    }
    documentPaths.add(document.path);
    if (sha256Text(document.content) !== document.sha256) {
      fail(`Interface contract document ${document.path} has an invalid content hash.`);
    }
  }
  if (bundle.formalContract.documents.length === 0 && bundle.formalContract.neutralManifest === null) {
    fail(`Interface contract ${bundle.id} must contain native documents or a neutral manifest.`);
  }
  const anchorRoots = new Set([
    ...bundle.formalContract.documents.map(({ path }) => path),
    ...(bundle.formalContract.neutralManifest === null ? [] : ["neutralManifest"]),
  ]);
  for (const interaction of bundle.normalizedIndex.interactions) {
    for (const anchor of interaction.nativeAnchors) {
      const [root, fragment] = anchor.split("#", 2);
      if (!anchorRoots.has(root) || fragment == null || fragment.length === 0) {
        fail(`Native anchor ${anchor} must identify a contract document or neutralManifest fragment.`);
      }
    }
  }
}

function validateSubjectContractBundle(
  bundle: SubjectContractBundle,
  design: BoundaryDesign,
  interfaces: readonly InterfaceContractBundle[],
  profileRevisionId: string,
): void {
  const subject = design.subjects.find(({ id }) => id === bundle.subjectId);
  if (subject == null) fail(`Subject contract ${bundle.id} references an unknown subject.`);
  if (bundle.boundaryRevisionId !== design.revisionId) {
    fail(`Subject contract ${bundle.id} is bound to the wrong boundary revision.`);
  }
  if (bundle.profileRevisionId !== profileRevisionId) {
    fail(`Subject contract ${bundle.id} is bound to the wrong profile revision.`);
  }
  const subjectInterfaceIds = design.interfaces
    .filter(({ subjectId }) => subjectId === bundle.subjectId)
    .map(({ id }) => id);
  const expectedInterfaceRevisions = interfaces
    .filter(({ interfaceId }) => subjectInterfaceIds.includes(interfaceId))
    .map(({ revisionId }) => revisionId);
  if (
    expectedInterfaceRevisions.length !== bundle.interfaceContractRevisionIds.length ||
    expectedInterfaceRevisions.some(
      (revisionId) => !bundle.interfaceContractRevisionIds.includes(revisionId),
    )
  ) {
    fail(`Subject contract ${bundle.id} does not bind all of its interface contracts.`);
  }
  if (!bundle.protocol.states.includes(bundle.protocol.initialState)) {
    fail(`Subject contract ${bundle.id} has an unknown initial state.`);
  }
  if (new Set(bundle.protocol.states).size !== bundle.protocol.states.length) {
    fail(`Subject contract ${bundle.id} contains duplicate protocol states.`);
  }
  uniqueIds(bundle.protocol.transitions, `${bundle.id} protocol transitions`);
  const states = new Set(bundle.protocol.states);
  const subjectInteractionIds = new Set(
    design.interactions
      .filter((interaction) => subjectInterfaceIds.includes(interaction.interfaceId))
      .map(({ id }) => id),
  );
  for (const transition of bundle.protocol.transitions) {
    if (!states.has(transition.fromState) || !states.has(transition.toState)) {
      fail(`Protocol transition ${transition.id} references an unknown state.`);
    }
    if (!subjectInteractionIds.has(transition.interactionId)) {
      fail(`Protocol transition ${transition.id} references an interaction outside its subject.`);
    }
    const normalized = interfaces
      .flatMap(({ normalizedIndex }) => normalizedIndex.interactions)
      .find(
        ({ semanticInteractionId }) =>
          semanticInteractionId === transition.interactionId,
      );
    if (
      normalized == null ||
      ![...normalized.outputs, ...normalized.errors].some(
        ({ id }) => id === transition.outcomeId,
      )
    ) {
      fail(
        `Protocol transition ${transition.id} references an unknown normalized outcome.`,
      );
    }
  }
  assertSafeJsonSchema(bundle.harness.fixtureSchema, `${bundle.id} fixture schema`);
  const boundInteractions = new Set(
    bundle.harness.interactions.map(({ interactionId }) => interactionId),
  );
  if (
    bundle.harness.interactions.length !== subjectInteractionIds.size ||
    subjectInteractionIds.size !== boundInteractions.size ||
    [...subjectInteractionIds].some((id) => !boundInteractions.has(id))
  ) {
    fail(`Harness binding ${bundle.id} must bind every subject interaction exactly once.`);
  }
}

function validateVerificationContract(
  contract: VerificationContract,
  design: BoundaryDesign,
  profileRevisionId: string,
): void {
  if (
    !design.verificationObligations.some(
      ({ id }) => id === contract.verificationObligationId,
    )
  ) {
    fail(`Verification contract ${contract.id} references an unknown obligation.`);
  }
  if (
    contract.boundaryRevisionId !== design.revisionId ||
    contract.profileRevisionId !== profileRevisionId
  ) {
    fail(`Verification contract ${contract.id} is bound to stale upstream revisions.`);
  }
  assertSafeJsonSchema(contract.evidenceSchema, `${contract.id} evidence schema`);
  contract.passMatchers.forEach((matcher, index) =>
    {
      const label = `${contract.id}.passMatchers[${index}]`;
      validatePortableMatcher(matcher, label);
      if ("pointer" in matcher) {
        validatePointerAgainstSchema(
          contract.evidenceSchema,
          matcher.pointer,
          label,
        );
      }
    },
  );
}

function validatePortableMatcher(matcher: PortableMatcher, label: string): void {
  if (matcher.kind === "regex" && !isResourceSafePattern(matcher.pattern)) {
    fail(`${label}.pattern is not resource-safe.`);
  }
  if (
    "pointer" in matcher &&
    !JSON_POINTER_PATTERN.test(matcher.pointer)
  ) {
    fail(`${label}.pointer must be a JSON Pointer.`);
  }
}

function pointerIsAddressable(schema: JsonSchema, pointer: string): boolean {
  if (pointer === "") return schema !== false;
  if (typeof schema === "boolean") return schema;
  const root = schema;
  const tokens = pointer
    .slice(1)
    .split("/")
    .map((token) => token.replaceAll("~1", "/").replaceAll("~0", "~"));
  const visit = (
    candidate: unknown,
    index: number,
    references: ReadonlySet<string>,
  ): boolean => {
    if (typeof candidate === "boolean") return candidate;
    if (!isRecord(candidate)) return false;
    if (typeof candidate.$ref === "string") {
      if (references.has(candidate.$ref)) return false;
      return visit(
        localReferenceTarget(root, candidate.$ref),
        index,
        new Set([...references, candidate.$ref]),
      );
    }
    if (index >= tokens.length) return true;
    const alternatives = ["allOf", "anyOf", "oneOf"].flatMap((keyword) =>
      Array.isArray(candidate[keyword]) ? candidate[keyword] as unknown[] : [],
    );
    if (
      alternatives.length > 0 &&
      alternatives.some((alternative) =>
        visit(alternative, index, references),
      )
    ) {
      return true;
    }
    const token = tokens[index];
    if (isRecord(candidate.properties) && token in candidate.properties) {
      return visit(candidate.properties[token], index + 1, references);
    }
    if (candidate.additionalProperties === false) return false;
    if (
      typeof candidate.additionalProperties === "boolean" ||
      isRecord(candidate.additionalProperties)
    ) {
      return visit(candidate.additionalProperties, index + 1, references);
    }
    if (
      candidate.type === "array" ||
      candidate.items !== undefined ||
      candidate.prefixItems !== undefined
    ) {
      if (!/^(?:0|[1-9][0-9]*)$/.test(token)) return false;
      const itemIndex = Number(token);
      if (Array.isArray(candidate.prefixItems) && itemIndex < candidate.prefixItems.length) {
        return visit(candidate.prefixItems[itemIndex], index + 1, references);
      }
      if (candidate.items === undefined) return true;
      return visit(candidate.items, index + 1, references);
    }
    if (
      candidate.type === "object" ||
      candidate.properties !== undefined
    ) {
      return true;
    }
    return candidate.type === undefined;
  };
  return visit(root, 0, new Set());
}

function validatePointerAgainstSchema(
  schema: JsonSchema,
  pointer: string,
  label: string,
): void {
  if (!pointerIsAddressable(schema, pointer)) {
    fail(`${label} does not address a value declared by its outcome schema.`);
  }
}

function parseBehavioralScenarioBinding(
  item: Record<string, unknown>,
  label: string,
): BehavioralScenarioBinding {
  exactKeys(
    item,
    [
      "kind",
      "subjectId",
      "interfaceIds",
      "boundaryRevisionId",
      "interfaceContractRevisionIds",
      "subjectContractRevisionId",
    ],
    label,
  );
  return {
    kind: "behavioral",
    subjectId: identifier(item.subjectId, `${label}.subjectId`),
    interfaceIds: stringArray(item.interfaceIds, `${label}.interfaceIds`, {
      identifiers: true,
    }),
    boundaryRevisionId: identifier(
      item.boundaryRevisionId,
      `${label}.boundaryRevisionId`,
    ),
    interfaceContractRevisionIds: stringArray(
      item.interfaceContractRevisionIds,
      `${label}.interfaceContractRevisionIds`,
      { identifiers: true },
    ),
    subjectContractRevisionId: identifier(
      item.subjectContractRevisionId,
      `${label}.subjectContractRevisionId`,
    ),
  };
}

export function parseTestScenarioBinding(
  value: unknown,
  label = "Test scenario binding",
): TestScenarioBinding {
  const item = record(value, label);
  const kind = enumValue(item.kind, ["behavioral", "verification"] as const, `${label}.kind`);
  if (kind === "behavioral") return parseBehavioralScenarioBinding(item, label);
  exactKeys(
    item,
    ["kind", "verificationObligationId", "boundaryRevisionId", "verificationContractRevisionId"],
    label,
  );
  return {
    kind,
    verificationObligationId: identifier(
      item.verificationObligationId,
      `${label}.verificationObligationId`,
    ),
    boundaryRevisionId: identifier(item.boundaryRevisionId, `${label}.boundaryRevisionId`),
    verificationContractRevisionId: identifier(
      item.verificationContractRevisionId,
      `${label}.verificationContractRevisionId`,
    ),
  };
}

function validateProposalGraph(
  items: readonly { key: string; id?: string; dependencies: string[] }[],
  label: string,
  allowedExistingIds: readonly string[],
): void {
  const keys = new Set<string>();
  const ids = new Set<string>();
  const allowed = new Set(allowedExistingIds);
  for (const item of items) {
    if (keys.has(item.key)) fail(`${label} contains duplicate key ${item.key}.`);
    keys.add(item.key);
    if (item.id !== undefined) {
      if (!allowed.has(item.id)) {
        fail(`${label} attempts to preserve unknown id ${item.id}.`);
      }
      if (ids.has(item.id)) fail(`${label} preserves id ${item.id} more than once.`);
      ids.add(item.id);
    }
  }
  const dependencies = new Map(items.map((item) => [item.key, item.dependencies]));
  for (const item of items) {
    for (const dependency of item.dependencies) {
      if (!keys.has(dependency)) {
        fail(`${label} item ${item.key} depends on unknown key ${dependency}.`);
      }
      if (dependency === item.key) {
        fail(`${label} item ${item.key} cannot depend on itself.`);
      }
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (key: string): void => {
    if (visiting.has(key)) fail(`${label} contains a dependency cycle at ${key}.`);
    if (visited.has(key)) return;
    visiting.add(key);
    dependencies.get(key)?.forEach(visit);
    visiting.delete(key);
    visited.add(key);
  };
  items.forEach(({ key }) => visit(key));
}

export function parseTestScenarioListProposal(
  value: unknown,
  allowedExistingIds: readonly string[] = [],
): TestScenarioListProposal {
  const list = record(value, "Test scenario proposal");
  exactKeys(list, ["items"], "Test scenario proposal");
  const result: TestScenarioListProposal = {
    items: array(list.items, "Test scenario proposal.items").map((candidate, index) => {
      const label = `Test scenario proposal.items[${index}]`;
      const item = record(candidate, label);
      exactKeys(
        item,
        [
          "key",
          "id",
          "title",
          "description",
          "priority",
          "acceptanceCriteriaIds",
          "binding",
          "dependencies",
        ],
        label,
      );
      return {
        key: proposalKey(item.key, `${label}.key`),
        ...(item.id === undefined ? {} : { id: identifier(item.id, `${label}.id`) }),
        title: text(item.title, `${label}.title`),
        description: text(item.description, `${label}.description`),
        priority: enumValue(item.priority, ["p0", "p1", "p2"] as const, `${label}.priority`),
        acceptanceCriteriaIds: stringArray(
          item.acceptanceCriteriaIds,
          `${label}.acceptanceCriteriaIds`,
          { identifiers: true },
        ),
        binding: parseTestScenarioBinding(item.binding, `${label}.binding`),
        dependencies: stringArray(item.dependencies, `${label}.dependencies`, {
          allowEmpty: true,
        }),
      };
    }),
  };
  validateProposalGraph(
    result.items,
    "Test scenario proposal",
    allowedExistingIds,
  );
  return result;
}

export function validateScenarioBinding(
  binding: TestScenarioBinding,
  design: BoundaryDesign,
  suite: ContractSuite,
): void {
  if (binding.boundaryRevisionId !== design.revisionId) {
    fail("Test scenario is bound to a stale boundary revision.");
  }
  if (binding.kind === "verification") {
    const contract = suite.verificationContracts.find(
      ({ revisionId }) => revisionId === binding.verificationContractRevisionId,
    );
    if (
      contract == null ||
      contract.verificationObligationId !== binding.verificationObligationId ||
      contract.status !== "approved"
    ) {
      fail("Verification scenario references a mismatched verification contract.");
    }
    return;
  }
  const subject = design.subjects.find(({ id }) => id === binding.subjectId);
  if (subject == null) fail("Behavioral scenario references an unknown subject.");
  for (const interfaceId of binding.interfaceIds) {
    const semanticInterface = design.interfaces.find(({ id }) => id === interfaceId);
    if (semanticInterface?.subjectId !== subject.id) {
      fail("Every interface in a scenario must belong to its single test subject.");
    }
  }
  const expectedInterfaceRevisions = binding.interfaceIds.map((interfaceId) => {
    const contract = suite.interfaceContracts.find(
      (candidate) => candidate.interfaceId === interfaceId,
    );
    if (contract == null || contract.status !== "approved") {
      fail(`Scenario interface ${interfaceId} does not have an approved contract.`);
    }
    return contract.revisionId;
  });
  if (
    expectedInterfaceRevisions.length !== binding.interfaceContractRevisionIds.length ||
    expectedInterfaceRevisions.some(
      (revisionId) => !binding.interfaceContractRevisionIds.includes(revisionId),
    )
  ) {
    fail("Behavioral scenario must bind the exact current interface contract revisions.");
  }
  const subjectContract = suite.subjectContracts.find(
    ({ revisionId }) => revisionId === binding.subjectContractRevisionId,
  );
  if (subjectContract?.subjectId !== subject.id || subjectContract.status !== "approved") {
    fail("Behavioral scenario must bind the approved subject protocol contract.");
  }
}

export function validateScenarioAcceptanceCriteria(
  acceptanceCriteriaIds: readonly string[],
  binding: TestScenarioBinding,
  design: BoundaryDesign,
): void {
  if (acceptanceCriteriaIds.length === 0) {
    fail("Test scenario must cover at least one acceptance criterion.");
  }
  if (new Set(acceptanceCriteriaIds).size !== acceptanceCriteriaIds.length) {
    fail("Test scenario acceptance-criteria references must not contain duplicates.");
  }
  const allowed = new Set(
    binding.kind === "verification"
      ? design.verificationObligations.find(
          ({ id }) => id === binding.verificationObligationId,
        )?.acceptanceCriteriaIds ?? []
      : design.interactions
          .filter(({ interfaceId }) => binding.interfaceIds.includes(interfaceId))
          .flatMap(({ acceptanceCriteriaIds: ids }) => ids),
  );
  for (const id of acceptanceCriteriaIds) {
    if (!allowed.has(id)) {
      fail(
        `Test scenario claims acceptance criterion ${id} outside its bound interface or verification obligation.`,
      );
    }
  }
}

function parseTraceEvent(value: unknown, label: string): BehavioralTraceEvent {
  const event = record(value, label);
  exactKeys(
    event,
    [
      "id",
      "kind",
      "correlationAlias",
      "interfaceId",
      "interactionId",
      "outcomeId",
      "payload",
      "matcher",
      "captures",
      "withinMs",
    ],
    label,
  );
  const kind = enumValue(
    event.kind,
    ["input", "output", "error", "event", "silence"] as const,
    `${label}.kind`,
  );
  const result: BehavioralTraceEvent = {
    id: identifier(event.id, `${label}.id`),
    kind,
    ...(event.correlationAlias === undefined
      ? {}
      : {
          correlationAlias: identifier(
            event.correlationAlias,
            `${label}.correlationAlias`,
          ),
        }),
    interfaceId: identifier(event.interfaceId, `${label}.interfaceId`),
    interactionId: identifier(event.interactionId, `${label}.interactionId`),
    ...(event.outcomeId === undefined
      ? {}
      : { outcomeId: identifier(event.outcomeId, `${label}.outcomeId`) }),
    ...(event.payload === undefined
      ? {}
      : { payload: jsonValue(event.payload, `${label}.payload`) }),
    ...(event.matcher === undefined
      ? {}
      : { matcher: parsePortableMatcher(event.matcher, `${label}.matcher`) }),
    captures: array(event.captures, `${label}.captures`).map((capture, index) => {
      const captureLabel = `${label}.captures[${index}]`;
      const item = record(capture, captureLabel);
      exactKeys(item, ["name", "pointer"], captureLabel);
      return {
        name: identifier(item.name, `${captureLabel}.name`),
        pointer: parsePointer(item.pointer, `${captureLabel}.pointer`),
      };
    }),
    ...(event.withinMs === undefined
      ? {}
      : { withinMs: positiveInteger(event.withinMs, `${label}.withinMs`) }),
  };
  return result;
}

export function parseTestCaseDefinition(
  value: unknown,
  label = "Test case definition",
): TestCaseDefinition {
  const definition = record(value, label);
  const kind = enumValue(definition.kind, ["behavioral", "verification"] as const, `${label}.kind`);
  if (kind === "verification") {
    exactKeys(
      definition,
      [
        "kind",
        "scenarioRevisionId",
        "setup",
        "stimulus",
        "evidence",
        "passMatchers",
        "verificationContractRevisionId",
      ],
      label,
    );
    return {
      kind,
      scenarioRevisionId: identifier(
        definition.scenarioRevisionId,
        `${label}.scenarioRevisionId`,
      ),
      setup: stringArray(definition.setup, `${label}.setup`),
      stimulus: stringArray(definition.stimulus, `${label}.stimulus`),
      evidence: stringArray(definition.evidence, `${label}.evidence`),
      passMatchers: array(definition.passMatchers, `${label}.passMatchers`).map(
        (matcher, index) => parsePortableMatcher(matcher, `${label}.passMatchers[${index}]`),
      ),
      verificationContractRevisionId: identifier(
        definition.verificationContractRevisionId,
        `${label}.verificationContractRevisionId`,
      ),
    } satisfies VerificationPlan;
  }
  exactKeys(
    definition,
    [
      "kind",
      "scenarioRevisionId",
      "subjectId",
      "initialFixture",
      "trace",
      "boundaryRevisionId",
      "interfaceContractRevisionIds",
      "subjectContractRevisionId",
    ],
    label,
  );
  return {
    kind,
    scenarioRevisionId: identifier(
      definition.scenarioRevisionId,
      `${label}.scenarioRevisionId`,
    ),
    subjectId: identifier(definition.subjectId, `${label}.subjectId`),
    initialFixture: jsonValue(definition.initialFixture, `${label}.initialFixture`),
    trace: array(definition.trace, `${label}.trace`).map((event, index) =>
      parseTraceEvent(event, `${label}.trace[${index}]`),
    ),
    boundaryRevisionId: identifier(
      definition.boundaryRevisionId,
      `${label}.boundaryRevisionId`,
    ),
    interfaceContractRevisionIds: stringArray(
      definition.interfaceContractRevisionIds,
      `${label}.interfaceContractRevisionIds`,
      { identifiers: true },
    ),
    subjectContractRevisionId: identifier(
      definition.subjectContractRevisionId,
      `${label}.subjectContractRevisionId`,
    ),
  } satisfies BehavioralCaseDefinition;
}

export function parseTestCaseListProposal(
  value: unknown,
  scenarioId: string,
  allowedExistingIds: readonly string[] = [],
): TestCaseListProposal {
  const list = record(value, "Test case proposal");
  exactKeys(list, ["items"], "Test case proposal");
  const result: TestCaseListProposal = {
    scenarioId,
    items: array(list.items, "Test case proposal.items").map((candidate, index) => {
      const label = `Test case proposal.items[${index}]`;
      const item = record(candidate, label);
      exactKeys(
        item,
        [
          "key",
          "id",
          "title",
          "description",
          "priority",
          "acceptanceCriteriaIds",
          "definition",
          "dependencies",
        ],
        label,
      );
      return {
        key: proposalKey(item.key, `${label}.key`),
        ...(item.id === undefined ? {} : { id: identifier(item.id, `${label}.id`) }),
        title: text(item.title, `${label}.title`),
        description: text(item.description, `${label}.description`),
        priority: enumValue(item.priority, ["p0", "p1", "p2"] as const, `${label}.priority`),
        acceptanceCriteriaIds: stringArray(
          item.acceptanceCriteriaIds,
          `${label}.acceptanceCriteriaIds`,
          { identifiers: true },
        ),
        definition: parseTestCaseDefinition(item.definition, `${label}.definition`),
        dependencies: stringArray(item.dependencies, `${label}.dependencies`, {
          allowEmpty: true,
        }),
      };
    }),
  };
  validateProposalGraph(
    result.items,
    "Test case proposal",
    allowedExistingIds,
  );
  return result;
}

function captureReferences(value: JsonValue): string[] {
  if (Array.isArray(value)) return value.flatMap(captureReferences);
  if (value !== null && typeof value === "object") {
    if (
      Object.keys(value).length === 1 &&
      typeof value.$capture === "string"
    ) {
      return [value.$capture];
    }
    return Object.values(value).flatMap(captureReferences);
  }
  return [];
}

function findNormalizedInteraction(
  suite: ContractSuite,
  interfaceId: string,
  interactionId: string,
) {
  return suite.interfaceContracts
    .find((bundle) => bundle.interfaceId === interfaceId)
    ?.normalizedIndex.interactions.find(
      (interaction) => interaction.semanticInteractionId === interactionId,
    );
}

export function validateBehavioralCase(
  definition: BehavioralCaseDefinition,
  scenario: BehavioralScenarioBinding,
  design: BoundaryDesign,
  suite: ContractSuite,
  scenarioRevisionId: string,
): void {
  if (
    definition.scenarioRevisionId !== scenarioRevisionId ||
    definition.subjectId !== scenario.subjectId ||
    definition.boundaryRevisionId !== scenario.boundaryRevisionId ||
    definition.subjectContractRevisionId !== scenario.subjectContractRevisionId
  ) {
    fail("Behavioral test case must bind the exact subject and revisions of its scenario.");
  }
  if (
    definition.interfaceContractRevisionIds.length !==
      scenario.interfaceContractRevisionIds.length ||
    definition.interfaceContractRevisionIds.some(
      (id) => !scenario.interfaceContractRevisionIds.includes(id),
    )
  ) {
    fail("Behavioral test case must bind the scenario's exact interface contract revisions.");
  }
  const subjectContract = suite.subjectContracts.find(
    ({ revisionId }) => revisionId === definition.subjectContractRevisionId,
  );
  if (subjectContract == null) fail("Behavioral test case references an unknown subject contract.");
  validateJsonSchemaInstance(
    subjectContract.harness.fixtureSchema,
    definition.initialFixture,
    "Behavioral test case initial fixture",
  );
  if (definition.trace.length === 0) fail("Behavioral test case trace cannot be empty.");
  uniqueIds(definition.trace, "Behavioral trace events");
  const captures = new Set<string>();
  const correlations = new Map<
    string,
    { interfaceId: string; interactionId: string; index: number }
  >();
  let assertionCount = 0;
  for (const [index, event] of definition.trace.entries()) {
    const label = `Behavioral trace event ${event.id}`;
    if (!scenario.interfaceIds.includes(event.interfaceId)) {
      fail(`${label} references an interface outside its scenario.`);
    }
    const normalized = findNormalizedInteraction(
      suite,
      event.interfaceId,
      event.interactionId,
    );
    if (normalized == null) fail(`${label} references an unknown interaction.`);
    const adapter = suite.interfaceContracts.find(
      ({ interfaceId }) => interfaceId === event.interfaceId,
    )?.adapter;
    if (adapter == null) fail(`${label} has no approved adapter.`);
    validateJsonSchemaInstance(adapter.toolSchemas.traceEvent, event, label);
    for (const reference of event.payload === undefined
      ? []
      : captureReferences(event.payload)) {
      if (!captures.has(reference)) {
        fail(`${label} uses capture ${reference} before it is defined.`);
      }
    }
    if (event.kind === "input") {
      if (event.payload === undefined) fail(`${label} must include an input payload.`);
      if (event.matcher !== undefined || event.outcomeId !== undefined) {
        fail(`${label} input cannot define an outcome matcher.`);
      }
      if (event.captures.length > 0) {
        fail(`${label} cannot capture values from an input.`);
      }
      if (event.correlationAlias === undefined) {
        fail(`${label} must define a correlation alias.`);
      }
      if (correlations.has(event.correlationAlias)) {
        fail(`${label} reuses correlation alias ${event.correlationAlias}.`);
      }
      if (captureReferences(event.payload).length === 0) {
        validateJsonSchemaInstance(normalized.inputSchema, event.payload, `${label} payload`);
      } else {
        validateJsonSchemaTemplate(normalized.inputSchema, event.payload, `${label} payload`);
      }
      correlations.set(event.correlationAlias, {
        interfaceId: event.interfaceId,
        interactionId: event.interactionId,
        index,
      });
    } else if (event.kind === "silence") {
      if (event.withinMs === undefined || event.withinMs > 60_000) {
        fail(`${label} must use a bounded wait of at most 60000 ms.`);
      }
      if (
        event.payload !== undefined ||
        event.matcher !== undefined ||
        event.outcomeId !== undefined
      ) {
        fail(`${label} silence observation cannot include payload, outcome, or matcher.`);
      }
      if (event.captures.length > 0) {
        fail(`${label} cannot capture a value from silence.`);
      }
      if (event.correlationAlias === undefined) {
        fail(`${label} must reference a correlation alias.`);
      }
      assertionCount += 1;
    } else {
      if (event.outcomeId === undefined || event.matcher === undefined) {
        fail(`${label} must identify an outcome and portable matcher.`);
      }
      const outcomes = event.kind === "error" ? normalized.errors : normalized.outputs;
      const outcome = outcomes.find(({ id }) => id === event.outcomeId);
      if (outcome == null) fail(`${label} references an unknown outcome.`);
      validatePortableMatcher(event.matcher, `${label}.matcher`);
      if ("pointer" in event.matcher) {
        validatePointerAgainstSchema(
          outcome.schema,
          event.matcher.pointer,
          `${label}.matcher.pointer`,
        );
      }
      if (event.kind !== "event" && event.correlationAlias === undefined) {
        fail(`${label} must reference a correlation alias.`);
      }
      if (event.matcher.kind === "exact") {
        validateJsonSchemaInstance(outcome.schema, event.matcher.value, `${label} exact value`);
      }
      for (const capture of event.captures) {
        validatePointerAgainstSchema(
          outcome.schema,
          capture.pointer,
          `${label} capture ${capture.name}`,
        );
      }
      assertionCount += 1;
    }
    if (event.correlationAlias !== undefined && event.kind !== "input") {
      const correlation = correlations.get(event.correlationAlias);
      if (
        correlation == null ||
        correlation.index >= index ||
        correlation.interfaceId !== event.interfaceId ||
        correlation.interactionId !== event.interactionId
      ) {
        fail(`${label} does not match a preceding input correlation.`);
      }
    }
    for (const capture of event.captures) {
      if (captures.has(capture.name)) fail(`${label} redefines capture ${capture.name}.`);
      captures.add(capture.name);
    }
  }
  if (assertionCount === 0) fail("Behavioral test case must contain an observable assertion.");
  validateScenarioBinding(scenario, design, suite);
}

export function validateVerificationPlan(
  plan: VerificationPlan,
  scenario: Extract<TestScenarioBinding, { kind: "verification" }>,
  suite: ContractSuite,
  scenarioRevisionId: string,
): void {
  if (plan.scenarioRevisionId !== scenarioRevisionId) {
    fail("Verification case must bind its parent scenario revision.");
  }
  if (plan.verificationContractRevisionId !== scenario.verificationContractRevisionId) {
    fail("Verification case must bind the scenario's exact verification contract revision.");
  }
  const contract = suite.verificationContracts.find(
    ({ revisionId }) => revisionId === plan.verificationContractRevisionId,
  );
  if (contract == null) fail("Verification case references an unknown contract.");
  if (
    fingerprint(plan.setup) !== fingerprint(contract.environment) ||
    fingerprint(plan.stimulus) !== fingerprint(contract.stimulus) ||
    fingerprint(plan.passMatchers) !== fingerprint(contract.passMatchers)
  ) {
    fail(
      "Verification case must use the exact environment, stimulus, and pass rules from its formal verification contract.",
    );
  }
  plan.passMatchers.forEach((matcher, index) =>
    validatePortableMatcher(matcher, `Verification plan matcher ${index + 1}`),
  );
}

export function validateTestCaseDefinition(
  definition: TestCaseDefinition,
  scenario: TestScenarioBinding,
  design: BoundaryDesign,
  suite: ContractSuite,
  scenarioRevisionId: string,
): void {
  if (definition.kind !== scenario.kind) {
    fail("Test case kind must match its parent scenario kind.");
  }
  if (definition.kind === "behavioral" && scenario.kind === "behavioral") {
    validateBehavioralCase(
      definition,
      scenario,
      design,
      suite,
      scenarioRevisionId,
    );
  } else if (definition.kind === "verification" && scenario.kind === "verification") {
    validateVerificationPlan(definition, scenario, suite, scenarioRevisionId);
  }
}

function parseConfiguration(value: unknown, label: string) {
  const config = record(value, label);
  exactKeys(
    config,
    ["packageManager", "testFramework", "buildCommand", "testCommand", "settings"],
    label,
  );
  const settings = record(config.settings, `${label}.settings`);
  return {
    packageManager: text(config.packageManager, `${label}.packageManager`),
    testFramework: text(config.testFramework, `${label}.testFramework`),
    buildCommand: text(config.buildCommand, `${label}.buildCommand`),
    testCommand: text(config.testCommand, `${label}.testCommand`),
    settings: Object.fromEntries(
      Object.entries(settings).map(([key, item]) => [
        key,
        jsonValue(item, `${label}.settings.${key}`),
      ]),
    ),
  };
}

export function parseProjectSetupProposal(value: unknown): ProjectSetupProposal {
  const setup = record(value, "Project setup");
  exactKeys(
    setup,
    [
      "boundaryRevisionId",
      "profileRevisionId",
      "contractSuiteRevisionId",
      "testDesignFingerprint",
      "configuration",
      "manifest",
      "files",
    ],
    "Project setup",
  );
  const manifest = record(setup.manifest, "Project setup.manifest");
  exactKeys(
    manifest,
    [
      "language",
      "moduleNames",
      "sourceRoots",
      "testRoots",
      "contractPlacements",
      "testTargets",
      "subjectBindings",
    ],
    "Project setup.manifest",
  );
  return {
    boundaryRevisionId: identifier(
      setup.boundaryRevisionId,
      "Project setup.boundaryRevisionId",
    ),
    profileRevisionId: identifier(setup.profileRevisionId, "Project setup.profileRevisionId"),
    contractSuiteRevisionId: identifier(
      setup.contractSuiteRevisionId,
      "Project setup.contractSuiteRevisionId",
    ),
    testDesignFingerprint: text(
      setup.testDesignFingerprint,
      "Project setup.testDesignFingerprint",
    ),
    configuration: parseConfiguration(setup.configuration, "Project setup.configuration"),
    manifest: {
      language: text(manifest.language, "Project setup.manifest.language"),
      moduleNames: stringArray(manifest.moduleNames, "Project setup.manifest.moduleNames"),
      sourceRoots: stringArray(manifest.sourceRoots, "Project setup.manifest.sourceRoots").map(
        (path, index) => safeVirtualPath(path, `Project setup.manifest.sourceRoots[${index}]`),
      ),
      testRoots: stringArray(manifest.testRoots, "Project setup.manifest.testRoots").map(
        (path, index) => safeVirtualPath(path, `Project setup.manifest.testRoots[${index}]`),
      ),
      contractPlacements: array(
        manifest.contractPlacements,
        "Project setup.manifest.contractPlacements",
      ).map((candidate, index) => {
        const label = `Project setup.manifest.contractPlacements[${index}]`;
        const item = record(candidate, label);
        exactKeys(
          item,
          ["interfaceContractRevisionId", "documentPath", "scaffoldPath", "sha256"],
          label,
        );
        return {
          interfaceContractRevisionId: identifier(
            item.interfaceContractRevisionId,
            `${label}.interfaceContractRevisionId`,
          ),
          documentPath: safeVirtualPath(item.documentPath, `${label}.documentPath`),
          scaffoldPath: safeVirtualPath(item.scaffoldPath, `${label}.scaffoldPath`),
          sha256: text(item.sha256, `${label}.sha256`),
        };
      }),
      testTargets: array(manifest.testTargets, "Project setup.manifest.testTargets").map(
        (candidate, index) => {
          const label = `Project setup.manifest.testTargets[${index}]`;
          const item = record(candidate, label);
          exactKeys(item, ["scenarioId", "path"], label);
          return {
            scenarioId: identifier(item.scenarioId, `${label}.scenarioId`),
            path: safeVirtualPath(item.path, `${label}.path`),
          };
        },
      ),
      subjectBindings: array(
        manifest.subjectBindings,
        "Project setup.manifest.subjectBindings",
      ).map((candidate, index) => {
        const label = `Project setup.manifest.subjectBindings[${index}]`;
        const item = record(candidate, label);
        exactKeys(
          item,
          ["subjectId", "subjectContractRevisionId", "moduleName", "sourcePath"],
          label,
        );
        return {
          subjectId: identifier(item.subjectId, `${label}.subjectId`),
          subjectContractRevisionId: identifier(
            item.subjectContractRevisionId,
            `${label}.subjectContractRevisionId`,
          ),
          moduleName: text(item.moduleName, `${label}.moduleName`),
          sourcePath: safeVirtualPath(item.sourcePath, `${label}.sourcePath`),
        };
      }),
    },
    files: array(setup.files, "Project setup.files").map((candidate, index) => {
      const label = `Project setup.files[${index}]`;
      const item = record(candidate, label);
      exactKeys(item, ["path", "content"], label);
      return {
        path: safeVirtualPath(item.path, `${label}.path`),
        content:
          typeof item.content === "string"
            ? item.content
            : fail(`${label}.content must be text.`),
      };
    }),
  };
}

export function validateProjectSetup(
  setup: ProjectSetup,
  design: BoundaryDesign,
  profile: ImplementationProfile,
  suite: ContractSuite,
  expectedTestDesignFingerprint: string,
  scenarioIds: ReadonlySet<string>,
): void {
  const isInsideRoot = (path: string, roots: readonly string[]) =>
    roots.some((root) => path.startsWith(`${root}/`));
  if (
    suite.interfaceContracts.some(({ status }) => status !== "approved") ||
    suite.subjectContracts.some(({ status }) => status !== "approved") ||
    suite.verificationContracts.some(({ status }) => status !== "approved")
  ) {
    fail("Project setup requires an entirely approved contract suite.");
  }
  if (
    setup.boundaryRevisionId !== design.revisionId ||
    setup.contractSuiteRevisionId !== suite.revisionId ||
    setup.profileRevisionId !== profile.revisionId ||
    setup.profileRevisionId !== suite.profileRevisionId
  ) {
    fail("Project setup is bound to stale contract revisions.");
  }
  if (setup.manifest.language !== profile.language) {
    fail("Scaffold manifest language must match the approved implementation profile.");
  }
  if (setup.testDesignFingerprint !== expectedTestDesignFingerprint) {
    fail("Project setup is bound to a stale test design.");
  }
  if (setup.files.length === 0 || setup.files.length > 150) {
    fail("Project setup must contain between 1 and 150 files.");
  }
  if (
    new Set(setup.manifest.testRoots.map((root) => root.toLowerCase())).size !==
    setup.manifest.testRoots.length
  ) {
    fail("Scaffold manifest cannot declare duplicate test roots.");
  }
  const files = new Map<string, string>();
  for (const file of setup.files) {
    safeVirtualPath(file.path, `Project setup file ${file.path}`);
    if (files.has(file.path)) fail(`Project setup contains duplicate file ${file.path}.`);
    files.set(file.path, file.content);
  }
  const expectedDocuments = suite.interfaceContracts.flatMap((bundle) =>
    bundle.formalContract.documents.map((document) => ({
      bundle,
      document,
    })),
  );
  if (setup.manifest.contractPlacements.length !== expectedDocuments.length) {
    fail("Scaffold manifest must place every approved native contract document exactly once.");
  }
  const placementPaths = new Set(
    setup.manifest.contractPlacements.map(({ scaffoldPath }) => scaffoldPath),
  );
  if (placementPaths.size !== setup.manifest.contractPlacements.length) {
    fail("Scaffold manifest cannot place multiple contracts at the same path.");
  }
  for (const placement of setup.manifest.contractPlacements) {
    if (!isInsideRoot(placement.scaffoldPath, setup.manifest.sourceRoots)) {
      fail(`Contract placement ${placement.scaffoldPath} must be inside a declared source root.`);
    }
  }
  for (const { bundle, document } of expectedDocuments) {
    const placement = setup.manifest.contractPlacements.find(
      (candidate) =>
        candidate.interfaceContractRevisionId === bundle.revisionId &&
        candidate.documentPath === document.path,
    );
    if (placement == null || placement.sha256 !== document.sha256) {
      fail(`Scaffold manifest has no hash-locked placement for ${document.path}.`);
    }
    const materialized = files.get(placement.scaffoldPath);
    if (materialized !== document.content || sha256Text(materialized) !== document.sha256) {
      fail(`Scaffold changed approved contract document ${document.path}.`);
    }
  }
  const targets = new Map<string, string>();
  const targetPaths = new Set<string>();
  for (const target of setup.manifest.testTargets) {
    if (!scenarioIds.has(target.scenarioId)) {
      fail(`Test target references unknown scenario ${target.scenarioId}.`);
    }
    if (targets.has(target.scenarioId)) {
      fail(`Scenario ${target.scenarioId} has more than one test target.`);
    }
    if (!isInsideRoot(target.path, setup.manifest.testRoots)) {
      fail(`Test target ${target.path} must be inside a declared test root.`);
    }
    if (targetPaths.has(target.path)) {
      fail(`Test target path ${target.path} is assigned to more than one scenario.`);
    }
    targetPaths.add(target.path);
    targets.set(target.scenarioId, target.path);
  }
  for (const scenarioId of scenarioIds) {
    if (!targets.has(scenarioId)) fail(`Scenario ${scenarioId} has no manifest test target.`);
  }
  for (const root of setup.manifest.testRoots) {
    if (![...targets.values()].some((path) => path.startsWith(`${root}/`))) {
      fail(`Declared test root ${root} has no scenario test target.`);
    }
  }
  const subjectBindings = new Set(setup.manifest.subjectBindings.map(({ subjectId }) => subjectId));
  if (
    subjectBindings.size !== setup.manifest.subjectBindings.length ||
    subjectBindings.size !== design.subjects.length
  ) {
    fail("Scaffold manifest must contain exactly one binding per subject.");
  }
  for (const subject of design.subjects) {
    if (!subjectBindings.has(subject.id)) {
      fail(`Scaffold manifest has no binding for subject ${subject.id}.`);
    }
    const binding = setup.manifest.subjectBindings.find(({ subjectId }) => subjectId === subject.id)!;
    const contract = suite.subjectContracts.find(({ subjectId }) => subjectId === subject.id);
    if (binding.subjectContractRevisionId !== contract?.revisionId) {
      fail(`Scaffold subject binding ${subject.id} uses a stale contract revision.`);
    }
    if (!files.has(binding.sourcePath)) {
      fail(`Scaffold subject binding ${subject.id} references a missing source file.`);
    }
    if (!files.get(binding.sourcePath)!.includes(UNIMPLEMENTED_BINDING_MARKER)) {
      fail(
        `Scaffold subject binding ${subject.id} must remain an explicitly unimplemented seam.`,
      );
    }
    if (!setup.manifest.moduleNames.includes(binding.moduleName)) {
      fail(`Scaffold subject binding ${subject.id} references an unknown module.`);
    }
    if (!isInsideRoot(binding.sourcePath, setup.manifest.sourceRoots)) {
      fail(`Scaffold subject binding ${subject.id} must be inside a declared source root.`);
    }
  }
}
