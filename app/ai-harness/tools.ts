import type { FunctionDefinition } from "openai/resources/shared";

import {
  collectArtifactIdentities,
  getExistingTargetIds,
} from "ai-harness/validation";
import type { ArtifactStageDefinition } from "ai-harness/workflow";
import type {
  BoundaryDesign,
  ContractSuite,
  ImplementationProfile,
  TestScenarioBinding,
} from "contract-domain";
import { projectProviderSchema } from "contract-domain";
import {
  Priority,
  StructuralFragment,
} from "store/constants";

export type HarnessToolDefinition = FunctionDefinition;

const objectSchema = (
  properties: Record<string, unknown>,
  required: readonly string[],
): Record<string, unknown> => ({
  type: "object",
  required,
  additionalProperties: false,
  properties,
});

const nonEmptyString = (description: string): Record<string, unknown> => ({
  type: "string",
  minLength: 1,
  description,
});

const stringArray = (
  description: string,
  options: { minItems?: number; values?: readonly string[] } = {},
): Record<string, unknown> => ({
  type: "array",
  description,
  ...(options.minItems === undefined ? {} : { minItems: options.minItems }),
  items: {
    type: "string",
    minLength: 1,
    ...(options.values === undefined || options.values.length === 0
      ? {}
      : { enum: options.values }),
  },
});

export const COMMUNICATE_TOOL: HarnessToolDefinition = {
  name: "communicate",
  description:
    "Ask the user one concise, actionable question when essential information is missing, contradictory, or unsafe to infer.",
  parameters: objectSchema(
    {
      message: nonEmptyString(
        "A concise explanation of what is missing and what the user must clarify.",
      ),
    },
    ["message"],
  ),
};

export function buildProductOverviewTool(): HarnessToolDefinition {
  return {
    name: "submit_product_overview",
    description: "Submit the complete product-overview proposal.",
    parameters: objectSchema(
      {
        name: nonEmptyString("The product name."),
        purpose: nonEmptyString("A concise, outcome-oriented purpose."),
        primaryFeatures: stringArray("Atomic primary feature descriptions.", {
          minItems: 1,
        }),
        targetUsers: stringArray("Specific target user groups.", {
          minItems: 1,
        }),
      },
      [
        "name",
        "purpose",
        "primaryFeatures",
        "targetUsers",
      ],
    ),
  };
}

function referenceSchema(
  definition: ArtifactStageDefinition,
  state: Record<string, unknown>,
): Record<string, unknown> {
  const allowedTypes = definition.allowedReferenceTypes;
  const allowedIds = [...collectArtifactIdentities(state).values()]
    .filter(({ type }) => allowedTypes.includes(type))
    .map(({ id }) => id);

  return objectSchema(
    {
      type: {
        type: "string",
        enum: allowedTypes,
        description: "The exact type of the referenced artifact.",
      },
      id: {
        ...nonEmptyString("An exact existing artifact ID from projectContext."),
        ...(allowedIds.length === 0 ? {} : { enum: allowedIds }),
      },
    },
    ["id", "type"],
  );
}

export function buildArtifactListTool({
  definition,
  state,
}: {
  definition: ArtifactStageDefinition;
  state: Record<string, unknown>;
}): HarnessToolDefinition {
  const existingIds = [...getExistingTargetIds(
    state,
    definition.entityType,
  )];
  const itemProperties: Record<string, unknown> = {
    key: {
      type: "string",
      minLength: 1,
      maxLength: 80,
      pattern: "^[A-Za-z0-9][A-Za-z0-9_-]*$",
      description:
        "A proposal-local key unique within this result. Dependencies refer to these keys; this is not a persisted artifact ID.",
    },
    content: nonEmptyString("The complete artifact text."),
    priority: {
      type: "string",
      enum: Object.values(Priority),
      description: "The artifact priority.",
    },
    dependencies: stringArray(
      "Proposal-local keys of items in this same result that must precede this item. Use an empty array when there are none.",
    ),
    references: {
      type: "array",
      minItems: 1,
      description: "Traceability references to exact upstream artifacts.",
      items: referenceSchema(definition, state),
    },
    ...(existingIds.length === 0
      ? {}
      : {
        id: {
          type: "string",
          enum: existingIds,
          description:
            "Include only when preserving the intent of this exact existing target artifact. Omit for new artifacts.",
        },
      }),
  };
  const itemRequired = [
    "key",
    "content",
    "priority",
    "references",
    "dependencies",
  ];

  return {
    name: `submit_${definition.entityType}_list`,
    description: `Submit the complete desired ${definition.entityType} list for the requested target only.`,
    parameters: objectSchema(
      {
        items: {
          type: "array",
          minItems: 1,
          description: "The complete desired target list, in display order.",
          items: objectSchema(itemProperties, itemRequired),
        },
      },
      ["items"],
    ),
  };
}

export function buildFragmentRevisionTool(
  entityType: StructuralFragment,
): HarnessToolDefinition {
  if (
    entityType === StructuralFragment.TestScenario ||
    entityType === StructuralFragment.TestCase ||
    entityType === StructuralFragment.TestCode
  ) {
    throw new Error(`${entityType} requires its contract-first revision flow.`);
  }
  const patchProperties = {
    content: nonEmptyString("Optional replacement content."),
    priority: { type: "string", enum: Object.values(Priority) },
  };

  return {
    name: "submit_fragment_revision",
    description: "Submit a patch for exactly the requested artifact.",
    parameters: objectSchema(
      {
        patch: {
          ...objectSchema(patchProperties, []),
          minProperties: 1,
        },
      },
      ["patch"],
    ),
  };
}

export function buildTestCodeTool(): HarnessToolDefinition {
  return {
    name: "submit_test_code",
    description:
      "Submit the complete scenario test-file content for the server-controlled target path.",
    parameters: objectSchema(
      {
        code: nonEmptyString("The complete executable scenario test file."),
      },
      ["code"],
    ),
  };
}

const identifierSchema = (description: string): Record<string, unknown> => ({
  type: "string",
  minLength: 1,
  maxLength: 128,
  pattern: "^[A-Za-z0-9][A-Za-z0-9_.:-]*$",
  description,
});

const jsonSchemaValue: Record<string, unknown> = {
  oneOf: [
    { type: "boolean" },
    {
      type: "object",
      description:
        "A self-contained JSON Schema using only the bounded keyword set described in the task.",
      additionalProperties: true,
    },
  ],
};

const stringList = (description: string, minItems = 0) => ({
  type: "array",
  description,
  minItems,
  uniqueItems: true,
  items: nonEmptyString("One list item."),
});

function enumStrings(values: readonly string[], description: string) {
  return {
    type: "string",
    ...(values.length === 0 ? {} : { enum: values }),
    description,
  };
}

export function buildBoundaryDesignTool({
  requirementIds,
  acceptanceCriteriaIds,
}: {
  requirementIds: readonly string[];
  acceptanceCriteriaIds: readonly string[];
}): HarnessToolDefinition {
  const requirementId = enumStrings(requirementIds, "An exact requirement ID.");
  const criterionId = enumStrings(
    acceptanceCriteriaIds,
    "An exact acceptance-criterion ID.",
  );
  return {
    name: "submit_boundary_design",
    description:
      "Submit the complete semantic test-subject, interface, interaction, verification, and coverage graph.",
    parameters: objectSchema(
      {
        rootSubjectId: identifierSchema("The ID of the root product subject."),
        subjects: {
          type: "array",
          minItems: 1,
          items: objectSchema(
            {
              id: identifierSchema("A stable subject ID."),
              name: nonEmptyString("A concise subject name."),
              purpose: nonEmptyString("The subject's observable purpose."),
              classification: enumStrings(
                ["external", "internal", "composite"],
                "The subject classification.",
              ),
              parentSubjectId: {
                oneOf: [identifierSchema("An existing parent subject ID."), { type: "null" }],
              },
              responsibilities: stringList("Responsibilities inside this boundary.", 1),
              exclusions: stringList("Responsibilities explicitly outside this boundary."),
              lifecycle: { type: "string", enum: ["fresh_per_case"] },
              requirementIds: {
                type: "array",
                uniqueItems: true,
                items: requirementId,
              },
              acceptanceCriteriaIds: {
                type: "array",
                uniqueItems: true,
                items: criterionId,
              },
            },
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
          ),
        },
        interfaces: {
          type: "array",
          minItems: 1,
          items: objectSchema(
            {
              id: identifierSchema("A stable interface ID."),
              subjectId: identifierSchema("The owning subject ID."),
              name: nonEmptyString("A concise interface name."),
              peer: nonEmptyString("The actor or peer using the interface."),
              visibility: enumStrings(["external", "internal"], "Interface visibility."),
              direction: enumStrings(
                ["inbound", "outbound", "bidirectional"],
                "Direction relative to the subject.",
              ),
              interactionStyle: enumStrings(
                ["request_response", "command", "query", "event", "stream", "interactive"],
                "The semantic interaction style.",
              ),
              interactionIds: {
                type: "array",
                minItems: 1,
                uniqueItems: true,
                items: identifierSchema("An interaction owned by this interface."),
              },
            },
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
          ),
        },
        interactions: {
          type: "array",
          minItems: 1,
          items: objectSchema(
            {
              id: identifierSchema("A stable semantic interaction ID."),
              interfaceId: identifierSchema("The owning interface ID."),
              name: nonEmptyString("A concise interaction name."),
              intent: nonEmptyString("The behavior exposed by the interaction."),
              inputDescription: nonEmptyString("Semantic input without implementation syntax."),
              outputDescription: nonEmptyString("Semantic observable output."),
              failureDescriptions: stringList("Meaningful observable failures."),
              stateEffects: stringList("Observable state effects."),
              requirementIds: {
                type: "array",
                uniqueItems: true,
                items: requirementId,
              },
              acceptanceCriteriaIds: {
                type: "array",
                minItems: 1,
                uniqueItems: true,
                items: criterionId,
              },
            },
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
          ),
        },
        verificationObligations: {
          type: "array",
          items: objectSchema(
            {
              id: identifierSchema("A stable verification-obligation ID."),
              name: nonEmptyString("A concise obligation name."),
              kind: enumStrings(
                [
                  "performance",
                  "security",
                  "accessibility",
                  "compatibility",
                  "static_analysis",
                  "manual_evidence",
                ],
                "The verification method family.",
              ),
              description: nonEmptyString("A measurable non-behavioral obligation."),
              requirementIds: {
                type: "array",
                uniqueItems: true,
                items: requirementId,
              },
              acceptanceCriteriaIds: {
                type: "array",
                minItems: 1,
                uniqueItems: true,
                items: criterionId,
              },
            },
            ["id", "name", "kind", "description", "requirementIds", "acceptanceCriteriaIds"],
          ),
        },
        coverage: {
          type: "array",
          minItems: acceptanceCriteriaIds.length,
          items: objectSchema(
            {
              acceptanceCriteriaId: criterionId,
              targetType: enumStrings(
                ["interaction", "verification_obligation"],
                "Coverage target type.",
              ),
              targetId: identifierSchema("The exact covered target ID."),
            },
            ["acceptanceCriteriaId", "targetType", "targetId"],
          ),
        },
      },
      [
        "rootSubjectId",
        "subjects",
        "interfaces",
        "interactions",
        "verificationObligations",
        "coverage",
      ],
    ),
  };
}

export function buildImplementationProfileTool(): HarnessToolDefinition {
  return {
    name: "submit_implementation_profile",
    description: "Submit the complete open-ended implementation and test ecosystem profile.",
    parameters: objectSchema(
      {
        platform: nonEmptyString("Target platform and operating environment."),
        runtime: nonEmptyString("Runtime and relevant version constraints."),
        language: nonEmptyString("Implementation language and relevant version."),
        framework: nonEmptyString("Framework or explicit framework-free approach."),
        moduleSystem: nonEmptyString("Module, package, or target organization."),
        buildEcosystem: nonEmptyString("Build and dependency ecosystem."),
        testEcosystem: nonEmptyString("Test runner, framework, and assertion ecosystem."),
        constraints: stringList("Additional project-mandated implementation constraints."),
      },
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
    ),
  };
}

const outcomeSchema = objectSchema(
  {
    id: identifierSchema("A stable outcome ID."),
    description: nonEmptyString("The outcome semantics."),
    schema: jsonSchemaValue,
  },
  ["id", "description", "schema"],
);

const matcherSchema: Record<string, unknown> = {
  oneOf: [
    objectSchema({ kind: { type: "string", enum: ["exact"] }, value: {} }, ["kind", "value"]),
    objectSchema({ kind: { type: "string", enum: ["schema"] } }, ["kind"]),
    objectSchema(
      {
        kind: { type: "string", enum: ["presence"] },
        pointer: { type: "string" },
        present: { type: "boolean" },
      },
      ["kind", "pointer", "present"],
    ),
    objectSchema({ kind: { type: "string", enum: ["subset"] }, value: {} }, ["kind", "value"]),
    objectSchema(
      {
        kind: { type: "string", enum: ["range"] },
        pointer: { type: "string" },
        minimum: { type: "number" },
        maximum: { type: "number" },
      },
      ["kind", "pointer"],
    ),
    objectSchema(
      {
        kind: { type: "string", enum: ["regex"] },
        pointer: { type: "string" },
        pattern: { type: "string", maxLength: 256 },
      },
      ["kind", "pointer", "pattern"],
    ),
    objectSchema(
      {
        kind: { type: "string", enum: ["unordered_list"] },
        pointer: { type: "string" },
        items: { type: "array" },
      },
      ["kind", "pointer", "items"],
    ),
  ],
};

export function buildContractSuiteTool(design: BoundaryDesign): HarnessToolDefinition {
  const interfaceIds = design.interfaces.map(({ id }) => id);
  const subjectIds = design.subjects.map(({ id }) => id);
  const obligationIds = design.verificationObligations.map(({ id }) => id);
  return {
    name: "submit_interface_contract_suite",
    description:
      "Submit all per-interface adapter/formal/index bundles, subject protocol/harness bundles, and verification contracts.",
    parameters: objectSchema(
      {
        interfaceContracts: {
          type: "array",
          minItems: interfaceIds.length,
          maxItems: interfaceIds.length,
          items: objectSchema(
            {
              interfaceId: enumStrings(interfaceIds, "An exact semantic interface ID."),
              adapter: objectSchema(
                {
                  id: identifierSchema("Stable adapter ID."),
                  version: nonEmptyString("Adapter semantic version."),
                  notation: nonEmptyString("Selected native or neutral notation."),
                  rationale: nonEmptyString("Why this notation fits the interface."),
                  formalizationInstructions: stringList("Stable formalization instructions.", 1),
                  revisionInstructions: stringList("Stable reconciliation instructions.", 1),
                  toolSchemas: objectSchema(
                    { formalContract: jsonSchemaValue, traceEvent: jsonSchemaValue },
                    ["formalContract", "traceEvent"],
                  ),
                },
                [
                  "id",
                  "version",
                  "notation",
                  "rationale",
                  "formalizationInstructions",
                  "revisionInstructions",
                  "toolSchemas",
                ],
              ),
              formalContract: objectSchema(
                {
                  format: nonEmptyString("Native standard/notation or neutral manifest format."),
                  summary: nonEmptyString("Reviewable interface-contract summary."),
                  documents: {
                    type: "array",
                    items: objectSchema(
                      {
                        path: nonEmptyString("Logical relative contract-document path."),
                        mediaType: nonEmptyString("Document media type."),
                        content: { type: "string" },
                      },
                      ["path", "mediaType", "content"],
                    ),
                  },
                  neutralManifest: {
                    description: "JSON-compatible neutral contract, or null when native documents are sufficient.",
                  },
                },
                ["format", "summary", "documents", "neutralManifest"],
              ),
              normalizedIndex: objectSchema(
                {
                  interfaceId: enumStrings(interfaceIds, "The same interface ID as the bundle."),
                  interactions: {
                    type: "array",
                    minItems: 1,
                    items: objectSchema(
                      {
                        semanticInteractionId: identifierSchema("Exact semantic interaction ID."),
                        operationId: identifierSchema("Stable formal operation ID."),
                        inputSchema: jsonSchemaValue,
                        outputs: { type: "array", minItems: 1, items: outcomeSchema },
                        errors: { type: "array", items: outcomeSchema },
                        nativeAnchors: stringList("Anchors into native documents.", 1),
                      },
                      [
                        "semanticInteractionId",
                        "operationId",
                        "inputSchema",
                        "outputs",
                        "errors",
                        "nativeAnchors",
                      ],
                    ),
                  },
                },
                ["interfaceId", "interactions"],
              ),
            },
            ["interfaceId", "adapter", "formalContract", "normalizedIndex"],
          ),
        },
        subjectContracts: {
          type: "array",
          minItems: subjectIds.length,
          maxItems: subjectIds.length,
          items: objectSchema(
            {
              subjectId: enumStrings(subjectIds, "An exact test-subject ID."),
              interfaceIds: {
                type: "array",
                uniqueItems: true,
                items: enumStrings(interfaceIds, "An interface owned by the subject."),
              },
              protocol: objectSchema(
                {
                  initialState: identifierSchema("Initial state ID."),
                  states: {
                    type: "array",
                    minItems: 1,
                    uniqueItems: true,
                    items: identifierSchema("A protocol state ID."),
                  },
                  transitions: {
                    type: "array",
                    items: objectSchema(
                      {
                        id: identifierSchema("Transition ID."),
                        fromState: identifierSchema("Source state ID."),
                        interactionId: identifierSchema("Semantic interaction ID."),
                        outcomeId: identifierSchema("Normalized outcome ID."),
                        toState: identifierSchema("Destination state ID."),
                        description: nonEmptyString("Transition semantics."),
                      },
                      ["id", "fromState", "interactionId", "outcomeId", "toState", "description"],
                    ),
                  },
                  orderingRules: stringList("Cross-interface causal ordering rules."),
                },
                ["initialState", "states", "transitions", "orderingRules"],
              ),
              harness: objectSchema(
                {
                  moduleSpecifier: nonEmptyString("Exact module/package/test target specifier."),
                  subjectType: nonEmptyString("Exact native subject type or endpoint identity."),
                  factoryKind: enumStrings(
                    ["constructor", "factory", "endpoint", "command", "fixture"],
                    "How a fresh subject is obtained.",
                  ),
                  freshInstance: nonEmptyString("Exact fresh-instance binding instruction."),
                  resetStrategy: nonEmptyString("Exact per-case reset/isolation instruction."),
                  fixtureSchema: jsonSchemaValue,
                  interactions: {
                    type: "array",
                    items: objectSchema(
                      {
                        interactionId: identifierSchema("Semantic interaction ID."),
                        invoke: nonEmptyString("Exact invocation binding."),
                        observe: nonEmptyString("Exact observation binding."),
                      },
                      ["interactionId", "invoke", "observe"],
                    ),
                  },
                },
                [
                  "moduleSpecifier",
                  "subjectType",
                  "factoryKind",
                  "freshInstance",
                  "resetStrategy",
                  "fixtureSchema",
                  "interactions",
                ],
              ),
            },
            ["subjectId", "interfaceIds", "protocol", "harness"],
          ),
        },
        verificationContracts: {
          type: "array",
          minItems: obligationIds.length,
          maxItems: obligationIds.length,
          items: objectSchema(
            {
              verificationObligationId: enumStrings(obligationIds, "Exact obligation ID."),
              environment: stringList("Required verification environment.", 1),
              stimulus: stringList("Required verification stimulus.", 1),
              evidenceSchema: jsonSchemaValue,
              passMatchers: { type: "array", minItems: 1, items: matcherSchema },
            },
            ["verificationObligationId", "environment", "stimulus", "evidenceSchema", "passMatchers"],
          ),
        },
      },
      ["interfaceContracts", "subjectContracts", "verificationContracts"],
    ),
  };
}

function scenarioBindingSchema(design: BoundaryDesign, suite: ContractSuite) {
  const behavioral = design.subjects.map((subject) => {
    const interfaces = design.interfaces.filter(({ subjectId }) => subjectId === subject.id);
    const interfaceContracts = interfaces.map((semanticInterface) =>
      suite.interfaceContracts.find(({ interfaceId }) => interfaceId === semanticInterface.id)!,
    );
    const subjectContract = suite.subjectContracts.find(
      ({ subjectId }) => subjectId === subject.id,
    )!;
    return objectSchema(
      {
        kind: { type: "string", enum: ["behavioral"] },
        subjectId: { type: "string", enum: [subject.id] },
        interfaceIds: {
          type: "array",
          minItems: 1,
          uniqueItems: true,
          items: enumStrings(interfaces.map(({ id }) => id), "An interface owned by this subject."),
        },
        boundaryRevisionId: { type: "string", enum: [design.revisionId] },
        interfaceContractRevisionIds: {
          type: "array",
          minItems: 1,
          uniqueItems: true,
          items: enumStrings(
            interfaceContracts.map(({ revisionId }) => revisionId),
            "An approved interface-contract revision.",
          ),
        },
        subjectContractRevisionId: {
          type: "string",
          enum: [subjectContract.revisionId],
        },
      },
      [
        "kind",
        "subjectId",
        "interfaceIds",
        "boundaryRevisionId",
        "interfaceContractRevisionIds",
        "subjectContractRevisionId",
      ],
    );
  });
  const verification = suite.verificationContracts.map((contract) =>
    objectSchema(
      {
        kind: { type: "string", enum: ["verification"] },
        verificationObligationId: {
          type: "string",
          enum: [contract.verificationObligationId],
        },
        boundaryRevisionId: { type: "string", enum: [design.revisionId] },
        verificationContractRevisionId: {
          type: "string",
          enum: [contract.revisionId],
        },
      },
      [
        "kind",
        "verificationObligationId",
        "boundaryRevisionId",
        "verificationContractRevisionId",
      ],
    ),
  );
  return { oneOf: [...behavioral, ...verification] };
}

export function buildTestScenarioListTool(
  design: BoundaryDesign,
  suite: ContractSuite,
  acceptanceCriteriaIds: readonly string[],
  existingIds: readonly string[],
): HarnessToolDefinition {
  return {
    name: "submit_test_scenario_list",
    description: "Submit the complete typed behavioral and verification scenario list.",
    parameters: objectSchema(
      {
        items: {
          type: "array",
          minItems: 1,
          items: objectSchema(
            {
              key: {
                type: "string",
                pattern: "^[A-Za-z0-9][A-Za-z0-9_-]*$",
                maxLength: 80,
              },
              ...(existingIds.length === 0
                ? {}
                : { id: enumStrings(existingIds, "Existing scenario ID to preserve.") }),
              title: nonEmptyString("Concise scenario title."),
              description: nonEmptyString("Behavioral situation or verification objective."),
              priority: enumStrings(Object.values(Priority), "Scenario priority."),
              acceptanceCriteriaIds: {
                type: "array",
                minItems: 1,
                uniqueItems: true,
                items: enumStrings(acceptanceCriteriaIds, "Covered acceptance criterion ID."),
              },
              binding: scenarioBindingSchema(design, suite),
              dependencies: {
                type: "array",
                uniqueItems: true,
                items: { type: "string" },
              },
            },
            [
              "key",
              "title",
              "description",
              "priority",
              "acceptanceCriteriaIds",
              "binding",
              "dependencies",
            ],
          ),
        },
      },
      ["items"],
    ),
  };
}

function canonicalTraceEventSchema(
  design: BoundaryDesign,
  suite: ContractSuite,
  binding: Extract<TestScenarioBinding, { kind: "behavioral" }>,
) {
  const variants = binding.interfaceIds.flatMap((interfaceId) => {
    const bundle = suite.interfaceContracts.find(
      (candidate) => candidate.interfaceId === interfaceId,
    )!;
    return bundle.normalizedIndex.interactions.map((interaction) =>
      objectSchema(
        {
          id: identifierSchema("Trace event ID."),
          kind: enumStrings(
            ["input", "output", "error", "event", "silence"],
            "Ordered trace event kind.",
          ),
          correlationAlias: identifierSchema(
            "Input-defined alias referenced by its output, error, or silence observations.",
          ),
          interfaceId: { type: "string", enum: [interfaceId] },
          interactionId: {
            type: "string",
            enum: [interaction.semanticInteractionId],
          },
          outcomeId: enumStrings(
            [...interaction.outputs, ...interaction.errors].map(({ id }) => id),
            "Exact normalized outcome ID when observing an outcome.",
          ),
          payload: {},
          matcher: matcherSchema,
          captures: {
            type: "array",
            items: objectSchema(
              {
                name: identifierSchema("Capture alias."),
                pointer: { type: "string", description: "JSON Pointer into the observed value." },
              },
              ["name", "pointer"],
            ),
          },
          withinMs: { type: "integer", minimum: 1, maximum: 60_000 },
        },
        ["id", "kind", "interfaceId", "interactionId", "captures"],
      ),
    );
  });
  const adapterSchemas = binding.interfaceIds.map((interfaceId) => {
    const bundle = suite.interfaceContracts.find(
      (candidate) => candidate.interfaceId === interfaceId,
    )!;
    return projectProviderSchema(bundle.adapter.toolSchemas.traceEvent);
  });
  return {
    allOf: [
      { oneOf: variants },
      ...(adapterSchemas.length === 1 ? adapterSchemas : [{ anyOf: adapterSchemas }]),
    ],
  };
}

export function buildTestCaseListTool({
  design,
  suite,
  binding,
  scenarioRevisionId,
  acceptanceCriteriaIds,
  existingIds,
}: {
  design: BoundaryDesign;
  suite: ContractSuite;
  binding: TestScenarioBinding;
  scenarioRevisionId: string;
  acceptanceCriteriaIds: readonly string[];
  existingIds: readonly string[];
}): HarnessToolDefinition {
  const definition =
    binding.kind === "behavioral"
      ? objectSchema(
          {
            kind: { type: "string", enum: ["behavioral"] },
            scenarioRevisionId: {
              type: "string",
              enum: [scenarioRevisionId],
            },
            subjectId: { type: "string", enum: [binding.subjectId] },
            initialFixture: {},
            trace: {
              type: "array",
              minItems: 1,
              items: canonicalTraceEventSchema(design, suite, binding),
            },
            boundaryRevisionId: { type: "string", enum: [binding.boundaryRevisionId] },
            interfaceContractRevisionIds: {
              type: "array",
              minItems: binding.interfaceContractRevisionIds.length,
              maxItems: binding.interfaceContractRevisionIds.length,
              uniqueItems: true,
              items: enumStrings(
                binding.interfaceContractRevisionIds,
                "Exact scenario interface-contract revision.",
              ),
            },
            subjectContractRevisionId: {
              type: "string",
              enum: [binding.subjectContractRevisionId],
            },
          },
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
        )
      : objectSchema(
          {
            kind: { type: "string", enum: ["verification"] },
            scenarioRevisionId: {
              type: "string",
              enum: [scenarioRevisionId],
            },
            setup: stringList("Ordered verification setup.", 1),
            stimulus: stringList("Ordered verification stimulus.", 1),
            evidence: stringList("Evidence to collect.", 1),
            passMatchers: { type: "array", minItems: 1, items: matcherSchema },
            verificationContractRevisionId: {
              type: "string",
              enum: [binding.verificationContractRevisionId],
            },
          },
          [
            "kind",
            "scenarioRevisionId",
            "setup",
            "stimulus",
            "evidence",
            "passMatchers",
            "verificationContractRevisionId",
          ],
        );
  return {
    name: "submit_test_case_list",
    description: "Submit the complete structured test-case list for one bound scenario.",
    parameters: objectSchema(
      {
        items: {
          type: "array",
          minItems: 1,
          items: objectSchema(
            {
              key: {
                type: "string",
                pattern: "^[A-Za-z0-9][A-Za-z0-9_-]*$",
                maxLength: 80,
              },
              ...(existingIds.length === 0
                ? {}
                : { id: enumStrings(existingIds, "Existing case ID to preserve.") }),
              title: nonEmptyString("Concise case title."),
              description: nonEmptyString("The behavior or evidence this case proves."),
              priority: enumStrings(Object.values(Priority), "Case priority."),
              acceptanceCriteriaIds: {
                type: "array",
                minItems: 1,
                uniqueItems: true,
                items: enumStrings(
                  acceptanceCriteriaIds,
                  "An acceptance criterion claimed by the target scenario.",
                ),
              },
              definition,
              dependencies: { type: "array", uniqueItems: true, items: { type: "string" } },
            },
            [
              "key",
              "title",
              "description",
              "priority",
              "acceptanceCriteriaIds",
              "definition",
              "dependencies",
            ],
          ),
        },
      },
      ["items"],
    ),
  };
}

export function buildProjectSetupTool({
  design,
  profile,
  suite,
  scenarioIds,
  testDesignFingerprint,
}: {
  design: BoundaryDesign;
  profile: ImplementationProfile;
  suite: ContractSuite;
  scenarioIds: readonly string[];
  testDesignFingerprint: string;
}): HarnessToolDefinition {
  return {
    name: "submit_project_setup",
    description:
      "Submit the complete build configuration, scaffold manifest, and minimal contract-bearing virtual filesystem.",
    parameters: objectSchema(
      {
        boundaryRevisionId: { type: "string", enum: [design.revisionId] },
        profileRevisionId: { type: "string", enum: [profile.revisionId] },
        contractSuiteRevisionId: { type: "string", enum: [suite.revisionId] },
        testDesignFingerprint: { type: "string", enum: [testDesignFingerprint] },
        configuration: objectSchema(
          {
            packageManager: nonEmptyString("Package or dependency manager."),
            testFramework: nonEmptyString("Test framework and runner."),
            buildCommand: nonEmptyString("Exact non-interactive build command."),
            testCommand: nonEmptyString("Exact non-interactive test command."),
            settings: { type: "object", additionalProperties: true },
          },
          ["packageManager", "testFramework", "buildCommand", "testCommand", "settings"],
        ),
        manifest: objectSchema(
          {
            language: { type: "string", enum: [profile.language] },
            moduleNames: stringList("Exact module or target names.", 1),
            sourceRoots: stringList("Relative source roots.", 1),
            testRoots: stringList("Relative test roots.", 1),
            contractPlacements: {
              type: "array",
              items: objectSchema(
                {
                  interfaceContractRevisionId: enumStrings(
                    suite.interfaceContracts.map(({ revisionId }) => revisionId),
                    "Exact approved interface-contract revision.",
                  ),
                  documentPath: nonEmptyString("Logical approved document path."),
                  scaffoldPath: nonEmptyString("Exact scaffold destination path."),
                  sha256: nonEmptyString("Approved document SHA-256."),
                },
                ["interfaceContractRevisionId", "documentPath", "scaffoldPath", "sha256"],
              ),
            },
            testTargets: {
              type: "array",
              minItems: scenarioIds.length,
              maxItems: scenarioIds.length,
              items: objectSchema(
                {
                  scenarioId: enumStrings(scenarioIds, "Exact scenario ID."),
                  path: nonEmptyString("Server-controlled scenario test-file path."),
                },
                ["scenarioId", "path"],
              ),
            },
            subjectBindings: {
              type: "array",
              minItems: design.subjects.length,
              maxItems: design.subjects.length,
              items: objectSchema(
                {
                  subjectId: enumStrings(
                    design.subjects.map(({ id }) => id),
                    "Exact test-subject ID.",
                  ),
                  subjectContractRevisionId: enumStrings(
                    suite.subjectContracts.map(({ revisionId }) => revisionId),
                    "Exact subject-contract revision.",
                  ),
                  moduleName: nonEmptyString("Exact module or target name."),
                  sourcePath: nonEmptyString(
                    "Unimplemented binding seam source path; its file contains REQUIREGANIZER_UNIMPLEMENTED_BINDING.",
                  ),
                },
                ["subjectId", "subjectContractRevisionId", "moduleName", "sourcePath"],
              ),
            },
          },
          [
            "language",
            "moduleNames",
            "sourceRoots",
            "testRoots",
            "contractPlacements",
            "testTargets",
            "subjectBindings",
          ],
        ),
        files: {
          type: "array",
          minItems: 1,
          maxItems: 150,
          items: objectSchema(
            {
              path: nonEmptyString("Safe relative POSIX path."),
              content: { type: "string", description: "Complete text file content." },
            },
            ["path", "content"],
          ),
        },
      },
      [
        "boundaryRevisionId",
        "profileRevisionId",
        "contractSuiteRevisionId",
        "testDesignFingerprint",
        "configuration",
        "manifest",
        "files",
      ],
    ),
  };
}
