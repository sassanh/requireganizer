import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertSafeJsonSchema,
  parseContractSuiteProposal,
  parseTestScenarioListProposal,
  sha256Text,
  validateBehavioralCase,
  validateBoundaryDesign,
  validateContractSuite,
  validateContractSuiteProposal,
  validateImplementationProfile,
  validateProjectSetup,
  validateScenarioAcceptanceCriteria,
  validateScenarioBinding,
  validateTestCaseDefinition,
  type BoundaryDesign,
  type ContractSuite,
  type ContractSuiteProposal,
  type ImplementationProfile,
  type ProjectSetup,
} from "../app/contract-domain";

const metadata = {
  id: "boundary",
  revisionId: "boundary-r1",
  revision: 1,
  status: "approved" as const,
  createdAt: "2026-08-13T00:00:00.000Z",
  approvedAt: "2026-08-13T00:01:00.000Z",
};

const design: BoundaryDesign = {
  ...metadata,
  requirementsRevisionId: "requirements-r1",
  acceptanceCriteriaRevisionId: "criteria-r1",
  rootSubjectId: "product",
  subjects: [{
    id: "product",
    name: "Product",
    purpose: "Expose calculator behavior",
    classification: "external",
    parentSubjectId: null,
    responsibilities: ["Calculate sums"],
    exclusions: [],
    lifecycle: "fresh_per_case",
    requirementIds: ["req-1"],
    acceptanceCriteriaIds: ["ac-1"],
  }],
  interfaces: [{
    id: "calculator-api",
    subjectId: "product",
    name: "Calculator API",
    peer: "caller",
    visibility: "external",
    direction: "inbound",
    interactionStyle: "request_response",
    interactionIds: ["add"],
  }],
  interactions: [{
    id: "add",
    interfaceId: "calculator-api",
    name: "Add",
    intent: "Add two numbers",
    inputDescription: "Two numbers",
    outputDescription: "Their sum",
    failureDescriptions: [],
    stateEffects: [],
    requirementIds: ["req-1"],
    acceptanceCriteriaIds: ["ac-1"],
  }],
  verificationObligations: [],
  coverage: [{ acceptanceCriteriaId: "ac-1", targetType: "interaction", targetId: "add" }],
};

const profile: ImplementationProfile = {
  ...metadata,
  id: "profile",
  revisionId: "profile-r1",
  boundaryRevisionId: "boundary-r1",
  platform: "Any supported Node.js host",
  runtime: "Node.js 22",
  language: "TypeScript",
  framework: "Framework-free library",
  moduleSystem: "ES modules",
  buildEcosystem: "pnpm and TypeScript",
  testEcosystem: "node:test",
  constraints: [],
};

const contractText = "export interface Calculator { add(left: number, right: number): number }";
const suite: ContractSuite = {
  id: "suite",
  revisionId: "suite-r1",
  revision: 1,
  createdAt: metadata.createdAt,
  boundaryRevisionId: design.revisionId,
  profileRevisionId: "profile-r1",
  interfaceContracts: [{
    ...metadata,
    id: "interface-contract",
    revisionId: "interface-r1",
    interfaceId: "calculator-api",
    boundaryRevisionId: design.revisionId,
    profileRevisionId: "profile-r1",
    adapter: {
      id: "calculator-adapter",
      version: "1.0.0",
      notation: "TypeScript",
      rationale: "Native typed interface",
      formalizationInstructions: ["Preserve operation IDs"],
      revisionInstructions: ["Reconcile the complete document"],
      toolSchemas: {
        formalContract: { type: "object" },
        traceEvent: { type: "object" },
      },
    },
    formalContract: {
      format: "TypeScript",
      summary: "Calculator boundary",
      documents: [{
        path: "contracts/calculator.ts",
        mediaType: "text/typescript",
        content: contractText,
        sha256: sha256Text(contractText),
      }],
      neutralManifest: null,
    },
    normalizedIndex: {
      interfaceId: "calculator-api",
      interactions: [{
        semanticInteractionId: "add",
        operationId: "add",
        inputSchema: {
          type: "object",
          required: ["left", "right"],
          additionalProperties: false,
          properties: { left: { type: "number" }, right: { type: "number" } },
        },
        outputs: [{
          id: "sum",
          description: "Sum result",
          schema: {
            type: "object",
            required: ["value"],
            additionalProperties: false,
            properties: { value: { type: "number" } },
          },
        }],
        errors: [],
        nativeAnchors: ["contracts/calculator.ts#Calculator.add"],
      }],
    },
  }],
  subjectContracts: [{
    ...metadata,
    id: "subject-contract",
    revisionId: "subject-r1",
    subjectId: "product",
    boundaryRevisionId: design.revisionId,
    profileRevisionId: "profile-r1",
    interfaceContractRevisionIds: ["interface-r1"],
    protocol: {
      initialState: "ready",
      states: ["ready"],
      transitions: [{
        id: "add-transition",
        fromState: "ready",
        interactionId: "add",
        outcomeId: "sum",
        toState: "ready",
        description: "Addition leaves calculator ready",
      }],
      orderingRules: [],
    },
    harness: {
      moduleSpecifier: "calculator",
      subjectType: "Calculator",
      factoryKind: "constructor",
      freshInstance: "new Calculator()",
      resetStrategy: "Create a new instance",
      fixtureSchema: { type: "object", additionalProperties: false },
      interactions: [{ interactionId: "add", invoke: "subject.add", observe: "return value" }],
    },
  }],
  verificationContracts: [],
};

const contractProposal: ContractSuiteProposal = {
  interfaceContracts: suite.interfaceContracts.map((contract) => ({
    interfaceId: contract.interfaceId,
    adapter: contract.adapter,
    formalContract: {
      ...contract.formalContract,
      documents: contract.formalContract.documents.map(
        ({ sha256: _sha256, ...document }) => document,
      ),
    },
    normalizedIndex: contract.normalizedIndex,
  })),
  subjectContracts: suite.subjectContracts.map((contract) => ({
    subjectId: contract.subjectId,
    interfaceIds: design.interfaces
      .filter(({ subjectId }) => subjectId === contract.subjectId)
      .map(({ id }) => id),
    protocol: contract.protocol,
    harness: contract.harness,
  })),
  verificationContracts: [],
};

const binding = {
  kind: "behavioral" as const,
  subjectId: "product",
  interfaceIds: ["calculator-api"],
  boundaryRevisionId: "boundary-r1",
  interfaceContractRevisionIds: ["interface-r1"],
  subjectContractRevisionId: "subject-r1",
};
const scenarioRevisionId = "scenario-r1";

describe("contract-first domain validation", () => {
  it("requires complete acceptance coverage and synchronized contract bundles", () => {
    validateBoundaryDesign(design, {
      requirementIds: new Set(["req-1"]),
      acceptanceCriteriaIds: new Set(["ac-1"]),
      requirementsRevisionId: "requirements-r1",
      acceptanceCriteriaRevisionId: "criteria-r1",
    });
    validateContractSuite(suite, design, "profile-r1");
    validateContractSuiteProposal(
      contractProposal,
      design,
      profile.revisionId,
    );
    validateImplementationProfile(profile, design.revisionId);
    validateScenarioAcceptanceCriteria(["ac-1"], binding, design);
    assert.throws(
      () => validateBoundaryDesign({ ...design, coverage: [] }, {
        requirementIds: new Set(["req-1"]),
        acceptanceCriteriaIds: new Set(["ac-1"]),
      }),
      /no verification coverage/,
    );
    assert.throws(
      () => validateBoundaryDesign(design, {
        requirementIds: new Set(["req-1"]),
        acceptanceCriteriaIds: new Set(["ac-1"]),
        requirementsRevisionId: "requirements-r2",
        acceptanceCriteriaRevisionId: "criteria-r1",
      }),
      /stale requirements revision/,
    );
    assert.throws(
      () => validateContractSuite({
        ...suite,
        interfaceContracts: [
          ...suite.interfaceContracts,
          {
            ...suite.interfaceContracts[0],
            id: "duplicate-interface-contract",
            revisionId: "duplicate-interface-r1",
            adapter: {
              ...suite.interfaceContracts[0].adapter,
              id: "duplicate-adapter",
            },
          },
        ],
      }, design, profile.revisionId),
      /exactly one bundle/,
    );
    assert.throws(
      () => validateContractSuite({
        ...suite,
        subjectContracts: suite.subjectContracts.map((contract) => ({
          ...contract,
          profileRevisionId: "profile-r2",
        })),
      }, design, profile.revisionId),
      /wrong profile revision/,
    );
    assert.throws(
      () => validateContractSuite({
        ...suite,
        subjectContracts: suite.subjectContracts.map((contract) => ({
          ...contract,
          protocol: {
            ...contract.protocol,
            transitions: contract.protocol.transitions.map((transition) => ({
              ...transition,
              outcomeId: "invented-outcome",
            })),
          },
        })),
      }, design, profile.revisionId),
      /unknown normalized outcome/,
    );
    assert.throws(
      () => validateImplementationProfile(
        { ...profile, language: "" },
        design.revisionId,
      ),
      /must be non-empty text/,
    );
    assert.throws(
      () => validateScenarioAcceptanceCriteria(["ac-outside"], binding, design),
      /outside its bound interface/,
    );
    assert.throws(
      () => validateContractSuiteProposal({
        ...contractProposal,
        interfaceContracts: contractProposal.interfaceContracts.map(
          (contract) => ({
            ...contract,
            normalizedIndex: {
              ...contract.normalizedIndex,
              interactions: [
                ...contract.normalizedIndex.interactions,
                ...contract.normalizedIndex.interactions.map((interaction) => ({
                  ...interaction,
                  operationId: `${interaction.operationId}-duplicate`,
                })),
              ],
            },
          }),
        ),
      }, design, profile.revisionId),
      /exactly once/,
    );
    assert.throws(
      () => parseContractSuiteProposal({
        ...contractProposal,
        interfaceContracts: contractProposal.interfaceContracts.map(
          (contract) => ({
            ...contract,
            adapter: {
              ...contract.adapter,
              toolSchemas: {
                formalContract: true,
                traceEvent: true,
              },
            },
          }),
        ),
      }),
      /must define object schemas, not booleans/,
    );
  });

  it("rejects unsafe adapter schemas before storage", () => {
    assert.throws(() => assertSafeJsonSchema({ $ref: "https://example.com/schema" }, "Adapter"), /must be local/);
    assert.throws(() => assertSafeJsonSchema({ type: "string", unevaluatedProperties: false }, "Adapter"), /unsupported JSON Schema keyword/);
    assert.throws(() => assertSafeJsonSchema({
      $defs: { recursive: { $ref: "#/$defs/recursive" } },
      $ref: "#/$defs/recursive",
    }, "Adapter"), /recursive reference cycle/);
    assert.throws(() => assertSafeJsonSchema({
      type: "object",
      properties: {
        nested: {
          $defs: { recursive: { $ref: "#/properties/nested/$defs/recursive" } },
          type: "string",
        },
      },
    }, "Adapter"), /recursive reference cycle/);
    assert.throws(() => assertSafeJsonSchema({ type: "string", pattern: "(a+)+" }, "Adapter"), /resource-safe/);
    assert.throws(() => assertSafeJsonSchema({
      type: "string",
      description: "x".repeat(64_000),
    }, "Adapter"), /exceeds/);
  });

  it("rejects fabricated persisted IDs and cyclic proposal dependencies", () => {
    const item = {
      key: "scenario-a",
      title: "Scenario A",
      description: "Verify A",
      priority: "p1",
      acceptanceCriteriaIds: ["ac-1"],
      binding: {
        kind: "verification",
        verificationObligationId: "latency",
        boundaryRevisionId: "boundary-r1",
        verificationContractRevisionId: "verification-r1",
      },
      dependencies: [] as string[],
    };
    assert.throws(
      () => parseTestScenarioListProposal({
        items: [{ ...item, id: "fabricated-id" }],
      }),
      /preserve unknown id/,
    );
    assert.throws(
      () => parseTestScenarioListProposal({
        items: [
          { ...item, dependencies: ["scenario-b"] },
          { ...item, key: "scenario-b", dependencies: ["scenario-a"] },
        ],
      }),
      /dependency cycle/,
    );
  });

  it("binds scenarios and structured traces to exact approved revisions", () => {
    validateScenarioBinding(binding, design, suite);
    validateBehavioralCase({
      kind: "behavioral",
      scenarioRevisionId,
      subjectId: "product",
      initialFixture: {},
      boundaryRevisionId: "boundary-r1",
      interfaceContractRevisionIds: ["interface-r1"],
      subjectContractRevisionId: "subject-r1",
      trace: [
        { id: "request", kind: "input", correlationAlias: "addition-1", interfaceId: "calculator-api", interactionId: "add", payload: { left: 1, right: 2 }, captures: [] },
        { id: "response", kind: "output", correlationAlias: "addition-1", interfaceId: "calculator-api", interactionId: "add", outcomeId: "sum", matcher: { kind: "exact", value: { value: 3 } }, captures: [{ name: "sumValue", pointer: "/value" }] },
      ],
    }, binding, design, suite, scenarioRevisionId);
    assert.throws(() => validateScenarioBinding({ ...binding, interfaceContractRevisionIds: ["fabricated"] }, design, suite), /exact current/);
    assert.throws(() => validateBehavioralCase({
      kind: "behavioral",
      scenarioRevisionId,
      subjectId: "product",
      initialFixture: {},
      boundaryRevisionId: "boundary-r1",
      interfaceContractRevisionIds: ["interface-r1"],
      subjectContractRevisionId: "subject-r1",
      trace: [
        { id: "request", kind: "input", correlationAlias: "addition-1", interfaceId: "calculator-api", interactionId: "add", payload: { left: 1, right: 2 }, captures: [] },
        { id: "response", kind: "output", correlationAlias: "addition-1", interfaceId: "calculator-api", interactionId: "add", outcomeId: "sum", matcher: { kind: "schema" }, captures: [{ name: "missing", pointer: "/notDeclared" }] },
      ],
    }, binding, design, suite, scenarioRevisionId), /does not address a value declared/);
  });

  it("rejects captures used before their observation", () => {
    assert.throws(() => validateBehavioralCase({
      kind: "behavioral",
      scenarioRevisionId,
      subjectId: "product",
      initialFixture: {},
      boundaryRevisionId: "boundary-r1",
      interfaceContractRevisionIds: ["interface-r1"],
      subjectContractRevisionId: "subject-r1",
      trace: [
        { id: "request", kind: "input", correlationAlias: "addition-1", interfaceId: "calculator-api", interactionId: "add", payload: { left: { $capture: "future" }, right: 2 }, captures: [] },
        { id: "response", kind: "output", correlationAlias: "addition-1", interfaceId: "calculator-api", interactionId: "add", outcomeId: "sum", matcher: { kind: "schema" }, captures: [{ name: "future", pointer: "/value" }] },
      ],
    }, binding, design, suite, scenarioRevisionId), /before it is defined/);
  });

  it("supports correlated multi-step captures without bypassing input schemas", () => {
    const prefix = [
      { id: "request-1", kind: "input" as const, correlationAlias: "addition-1", interfaceId: "calculator-api", interactionId: "add", payload: { left: 1, right: 2 }, captures: [] },
      { id: "response-1", kind: "output" as const, correlationAlias: "addition-1", interfaceId: "calculator-api", interactionId: "add", outcomeId: "sum", matcher: { kind: "schema" as const }, captures: [{ name: "firstSum", pointer: "/value" }] },
    ];
    const definition = {
      kind: "behavioral" as const,
      scenarioRevisionId,
      subjectId: "product",
      initialFixture: {},
      boundaryRevisionId: "boundary-r1",
      interfaceContractRevisionIds: ["interface-r1"],
      subjectContractRevisionId: "subject-r1",
      trace: [
        ...prefix,
        { id: "request-2", kind: "input" as const, correlationAlias: "addition-2", interfaceId: "calculator-api", interactionId: "add", payload: { left: { $capture: "firstSum" }, right: 4 }, captures: [] },
        { id: "response-2", kind: "output" as const, correlationAlias: "addition-2", interfaceId: "calculator-api", interactionId: "add", outcomeId: "sum", matcher: { kind: "exact" as const, value: { value: 7 } }, captures: [] },
      ],
    };

    validateBehavioralCase(
      definition,
      binding,
      design,
      suite,
      scenarioRevisionId,
    );
    assert.throws(
      () => validateBehavioralCase({
        ...definition,
        trace: [
          ...prefix,
          { ...definition.trace[2], payload: { left: { $capture: "firstSum" }, right: 4, invented: true } },
          definition.trace[3],
        ],
      }, binding, design, suite, scenarioRevisionId),
      /does not satisfy its schema/,
    );
  });

  it("requires observations to reference their exact preceding input", () => {
    const base = {
      kind: "behavioral" as const,
      scenarioRevisionId,
      subjectId: "product",
      initialFixture: {},
      boundaryRevisionId: "boundary-r1",
      interfaceContractRevisionIds: ["interface-r1"],
      subjectContractRevisionId: "subject-r1",
    };
    assert.throws(() => validateBehavioralCase({
      ...base,
      trace: [
        { id: "request", kind: "input", correlationAlias: "addition-1", interfaceId: "calculator-api", interactionId: "add", payload: { left: 1, right: 2 }, captures: [] },
        { id: "response", kind: "output", correlationAlias: "unknown", interfaceId: "calculator-api", interactionId: "add", outcomeId: "sum", matcher: { kind: "schema" }, captures: [] },
      ],
    }, binding, design, suite, scenarioRevisionId), /preceding input correlation/);

    validateBehavioralCase({
      ...base,
      trace: [
        { id: "request", kind: "input", correlationAlias: "addition-1", interfaceId: "calculator-api", interactionId: "add", payload: { left: 1, right: 2 }, captures: [] },
        { id: "silence", kind: "silence", correlationAlias: "addition-1", interfaceId: "calculator-api", interactionId: "add", withinMs: 100, captures: [] },
      ],
    }, binding, design, suite, scenarioRevisionId);
  });

  it("allows multiple approved interfaces of one subject and rejects cross-subject bindings", () => {
    const auditText = "export interface Audit { record(value: number): boolean }";
    const multiDesign: BoundaryDesign = {
      ...design,
      interfaces: [
        ...design.interfaces,
        {
          id: "audit-api",
          subjectId: "product",
          name: "Audit API",
          peer: "audit sink",
          visibility: "internal",
          direction: "outbound",
          interactionStyle: "request_response",
          interactionIds: ["record"],
        },
      ],
      interactions: [
        ...design.interactions,
        {
          id: "record",
          interfaceId: "audit-api",
          name: "Record",
          intent: "Record a calculated value",
          inputDescription: "Calculated value",
          outputDescription: "Acknowledgement",
          failureDescriptions: [],
          stateEffects: [],
          requirementIds: ["req-1"],
          acceptanceCriteriaIds: ["ac-1"],
        },
      ],
    };
    const auditContract = {
      ...suite.interfaceContracts[0],
      id: "audit-interface-contract",
      revisionId: "audit-interface-r1",
      interfaceId: "audit-api",
      adapter: { ...suite.interfaceContracts[0].adapter, id: "audit-adapter" },
      formalContract: {
        format: "TypeScript",
        summary: "Audit boundary",
        documents: [{
          path: "contracts/audit.ts",
          mediaType: "text/typescript",
          content: auditText,
          sha256: sha256Text(auditText),
        }],
        neutralManifest: null,
      },
      normalizedIndex: {
        interfaceId: "audit-api",
        interactions: [{
          semanticInteractionId: "record",
          operationId: "record",
          inputSchema: {
            type: "object",
            required: ["value"],
            additionalProperties: false,
            properties: { value: { type: "number" } },
          },
          outputs: [{
            id: "recorded",
            description: "Audit acknowledgement",
            schema: {
              type: "object",
              required: ["accepted"],
              additionalProperties: false,
              properties: { accepted: { type: "boolean" } },
            },
          }],
          errors: [],
          nativeAnchors: ["contracts/audit.ts#Audit.record"],
        }],
      },
    };
    const multiSuite: ContractSuite = {
      ...suite,
      interfaceContracts: [...suite.interfaceContracts, auditContract],
      subjectContracts: [{
        ...suite.subjectContracts[0],
        revisionId: "subject-multi-r1",
        interfaceContractRevisionIds: ["interface-r1", "audit-interface-r1"],
        harness: {
          ...suite.subjectContracts[0].harness,
          interactions: [
            ...suite.subjectContracts[0].harness.interactions,
            { interactionId: "record", invoke: "subject.record", observe: "return value" },
          ],
        },
      }],
    };
    const multiBinding = {
      kind: "behavioral" as const,
      subjectId: "product",
      interfaceIds: ["calculator-api", "audit-api"],
      boundaryRevisionId: "boundary-r1",
      interfaceContractRevisionIds: ["interface-r1", "audit-interface-r1"],
      subjectContractRevisionId: "subject-multi-r1",
    };
    validateBehavioralCase({
      kind: "behavioral",
      scenarioRevisionId,
      subjectId: "product",
      initialFixture: {},
      boundaryRevisionId: "boundary-r1",
      interfaceContractRevisionIds: ["interface-r1", "audit-interface-r1"],
      subjectContractRevisionId: "subject-multi-r1",
      trace: [
        { id: "calculate", kind: "input", correlationAlias: "addition", interfaceId: "calculator-api", interactionId: "add", payload: { left: 1, right: 2 }, captures: [] },
        { id: "calculated", kind: "output", correlationAlias: "addition", interfaceId: "calculator-api", interactionId: "add", outcomeId: "sum", matcher: { kind: "schema" }, captures: [{ name: "sum", pointer: "/value" }] },
        { id: "record", kind: "input", correlationAlias: "audit", interfaceId: "audit-api", interactionId: "record", payload: { value: { $capture: "sum" } }, captures: [] },
        { id: "recorded", kind: "output", correlationAlias: "audit", interfaceId: "audit-api", interactionId: "record", outcomeId: "recorded", matcher: { kind: "exact", value: { accepted: true } }, captures: [] },
      ],
    }, multiBinding, multiDesign, multiSuite, scenarioRevisionId);

    const crossSubjectDesign: BoundaryDesign = {
      ...multiDesign,
      subjects: [
        ...multiDesign.subjects,
        {
          ...multiDesign.subjects[0],
          id: "audit-subject",
          name: "Audit subject",
          classification: "internal",
          parentSubjectId: "product",
        },
      ],
      interfaces: multiDesign.interfaces.map((item) =>
        item.id === "audit-api" ? { ...item, subjectId: "audit-subject" } : item,
      ),
    };
    assert.throws(
      () => validateScenarioBinding(
        multiBinding,
        crossSubjectDesign,
        multiSuite,
      ),
      /single test subject/,
    );
  });

  it("supports declared failures and unsolicited asynchronous events", () => {
    const failureSuite: ContractSuite = {
      ...suite,
      interfaceContracts: suite.interfaceContracts.map((bundle) => ({
        ...bundle,
        normalizedIndex: {
          ...bundle.normalizedIndex,
          interactions: bundle.normalizedIndex.interactions.map((interaction) => ({
            ...interaction,
            errors: [{
              id: "invalid-operands",
              description: "Operands are invalid",
              schema: {
                type: "object",
                required: ["code"],
                additionalProperties: false,
                properties: { code: { type: "string" } },
              },
            }],
          })),
        },
      })),
    };
    const base = {
      kind: "behavioral" as const,
      scenarioRevisionId,
      subjectId: "product",
      initialFixture: {},
      boundaryRevisionId: "boundary-r1",
      interfaceContractRevisionIds: ["interface-r1"],
      subjectContractRevisionId: "subject-r1",
    };
    validateBehavioralCase({
      ...base,
      trace: [
        { id: "request", kind: "input", correlationAlias: "addition-1", interfaceId: "calculator-api", interactionId: "add", payload: { left: 1, right: 2 }, captures: [] },
        { id: "failure", kind: "error", correlationAlias: "addition-1", interfaceId: "calculator-api", interactionId: "add", outcomeId: "invalid-operands", matcher: { kind: "exact", value: { code: "invalid" } }, captures: [] },
      ],
    }, binding, design, failureSuite, scenarioRevisionId);
    validateBehavioralCase({
      ...base,
      trace: [{ id: "event", kind: "event", interfaceId: "calculator-api", interactionId: "add", outcomeId: "sum", matcher: { kind: "schema" }, captures: [] }],
    }, binding, design, suite, scenarioRevisionId);
  });

  it("binds non-behavioral cases to exact formal verification rules", () => {
    const verificationDesign: BoundaryDesign = {
      ...design,
      verificationObligations: [{
        id: "latency",
        name: "Response latency",
        kind: "performance",
        description: "Measure response latency under the declared load.",
        requirementIds: ["req-1"],
        acceptanceCriteriaIds: ["ac-1"],
      }],
      coverage: [{
        acceptanceCriteriaId: "ac-1",
        targetType: "verification_obligation",
        targetId: "latency",
      }],
    };
    const verificationSuite: ContractSuite = {
      ...suite,
      verificationContracts: [{
        ...metadata,
        id: "verification-contract",
        revisionId: "verification-r1",
        verificationObligationId: "latency",
        boundaryRevisionId: design.revisionId,
        profileRevisionId: "profile-r1",
        environment: ["Run on the declared reference host."],
        stimulus: ["Submit 100 sequential addition requests."],
        evidenceSchema: {
          type: "object",
          required: ["p95Ms"],
          additionalProperties: false,
          properties: { p95Ms: { type: "number" } },
        },
        passMatchers: [{
          kind: "range",
          pointer: "/p95Ms",
          maximum: 100,
        }],
      }],
    };
    const verificationBinding = {
      kind: "verification" as const,
      verificationObligationId: "latency",
      boundaryRevisionId: "boundary-r1",
      verificationContractRevisionId: "verification-r1",
    };
    const plan = {
      kind: "verification" as const,
      scenarioRevisionId,
      setup: ["Run on the declared reference host."],
      stimulus: ["Submit 100 sequential addition requests."],
      evidence: ["Collect p95Ms in the evidence record."],
      passMatchers: [{ kind: "range" as const, pointer: "/p95Ms", maximum: 100 }],
      verificationContractRevisionId: "verification-r1",
    };

    validateScenarioBinding(
      verificationBinding,
      verificationDesign,
      verificationSuite,
    );
    validateTestCaseDefinition(
      plan,
      verificationBinding,
      verificationDesign,
      verificationSuite,
      scenarioRevisionId,
    );
    assert.throws(() => validateTestCaseDefinition({
      ...plan,
      passMatchers: [{ kind: "range", pointer: "/p95Ms", maximum: 500 }],
    }, verificationBinding, verificationDesign, verificationSuite, scenarioRevisionId), /exact environment, stimulus, and pass rules/);
  });

  it("verifies byte-for-byte contract placement in project setup", () => {
    const setup: ProjectSetup = {
      ...metadata,
      id: "setup",
      revisionId: "setup-r1",
      boundaryRevisionId: "boundary-r1",
      profileRevisionId: "profile-r1",
      contractSuiteRevisionId: "suite-r1",
      testDesignFingerprint: "tests-r1",
      configuration: { packageManager: "pnpm", testFramework: "node:test", buildCommand: "pnpm build", testCommand: "pnpm test", settings: {} },
      manifest: {
        language: "TypeScript",
        moduleNames: ["calculator"],
        sourceRoots: ["src"],
        testRoots: ["tests"],
        contractPlacements: [{ interfaceContractRevisionId: "interface-r1", documentPath: "contracts/calculator.ts", scaffoldPath: "src/contracts/calculator.ts", sha256: sha256Text(contractText) }],
        testTargets: [{ scenarioId: "scenario-1", path: "tests/scenario-1.test.ts" }],
        subjectBindings: [{ subjectId: "product", subjectContractRevisionId: "subject-r1", moduleName: "calculator", sourcePath: "src/calculator.ts" }],
      },
      files: [
        { path: "src/contracts/calculator.ts", content: contractText },
        { path: "src/calculator.ts", content: "// REQUIREGANIZER_UNIMPLEMENTED_BINDING\nthrow new Error('Not implemented')" },
      ],
    };
    validateProjectSetup(setup, design, profile, suite, "tests-r1", new Set(["scenario-1"]));
    assert.throws(() => validateProjectSetup({ ...setup, files: setup.files.map((file) => file.path.includes("contracts") ? { ...file, content: `${file.content}\n` } : file) }, design, profile, suite, "tests-r1", new Set(["scenario-1"])), /changed approved contract/);
    assert.throws(() => validateProjectSetup({
      ...setup,
      manifest: {
        ...setup.manifest,
        testTargets: [{ scenarioId: "scenario-1", path: "src/scenario-1.test.ts" }],
      },
    }, design, profile, suite, "tests-r1", new Set(["scenario-1"])), /declared test root/);
    assert.throws(() => validateProjectSetup({
      ...setup,
      manifest: {
        ...setup.manifest,
        subjectBindings: setup.manifest.subjectBindings.map((binding) => ({
          ...binding,
          moduleName: "invented-module",
        })),
      },
    }, design, profile, suite, "tests-r1", new Set(["scenario-1"])), /unknown module/);
    assert.throws(() => validateProjectSetup({
      ...setup,
      files: setup.files.map((file) =>
        file.path === "src/calculator.ts"
          ? { ...file, content: "export class Calculator {}" }
          : file,
      ),
    }, design, profile, suite, "tests-r1", new Set(["scenario-1"])), /explicitly unimplemented seam/);
    assert.throws(() => validateProjectSetup({
      ...setup,
      manifest: { ...setup.manifest, language: "JavaScript" },
    }, design, profile, suite, "tests-r1", new Set(["scenario-1"])), /approved implementation profile/);
    assert.throws(() => validateProjectSetup({
      ...setup,
      manifest: { ...setup.manifest, testRoots: ["tests", "Tests"] },
    }, design, profile, suite, "tests-r1", new Set(["scenario-1"])), /duplicate test roots/);
  });
});
