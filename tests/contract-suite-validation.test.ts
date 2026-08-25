import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseContractSuiteProposal,
  validateContractSuiteProposal,
} from "../app/contract-domain";

const design = {
  id: "boundary",
  revisionId: "boundary-r1",
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
};

function validProposal(): Record<string, any> {
  return {
    interfaceContracts: [{
      interfaceId: "calculator-api",
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
        summary: "Calculator contract",
        documents: [{
          path: "contracts/calculator.ts",
          mediaType: "text/x-typescript",
          content: "export interface Calculator { add(left: number, right: number): number }",
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
            properties: { left: { type: "number" }, right: { type: "number" } },
            required: ["left", "right"],
          },
          outputs: [{ id: "sum", description: "The sum", schema: { type: "number" } }],
          errors: [],
          nativeAnchors: ["contracts/calculator.ts#add"],
        }],
      },
    }],
    subjectContracts: [{
      subjectId: "product",
      interfaceIds: ["calculator-api"],
      protocol: {
        initialState: "idle",
        states: ["idle"],
        transitions: [{
          id: "t-add",
          fromState: "idle",
          interactionId: "add",
          outcomeId: "sum",
          toState: "idle",
          description: "Adds two numbers",
        }],
        orderingRules: [],
      },
      harness: {
        moduleSpecifier: "./calculator.js",
        subjectType: "CalculatorModule",
        factoryKind: "constructor",
        freshInstance: "new Calculator()",
        resetStrategy: "fresh instance per case",
        fixtureSchema: { type: "object" },
        interactions: [{ interactionId: "add", invoke: "add(left, right)", observe: "return value" }],
      },
    }],
    verificationContracts: [],
  };
}

function parseError(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("Expected the parser to throw, but it succeeded.");
}

describe("contract suite proposal parsing and validation", () => {
  it("parses and fully validates a complete proposal", () => {
    const proposal = parseContractSuiteProposal(validProposal());
    assert.equal(proposal.interfaceContracts.length, 1);
    assert.equal(proposal.subjectContracts[0].protocol.transitions.length, 1);
    assert.doesNotThrow(() =>
      validateContractSuiteProposal(proposal, design as never, "profile-r1"),
    );
  });

  it("rejects boolean tool schemas — they would accept anything", () => {
    const proposal = validProposal();
    proposal.interfaceContracts[0].adapter.toolSchemas = {
      formalContract: true,
      traceEvent: { type: "object" },
    } as never;
    assert.match(
      parseError(() => parseContractSuiteProposal(proposal)),
      /must define object schemas, not booleans/,
    );
  });

  it("requires exactly one bundle per semantic interface", () => {
    const proposal = validProposal();
    delete (proposal.interfaceContracts[0] as { interfaceId?: string }).interfaceId;
    assert.throws(
      () => parseContractSuiteProposal(proposal),
      /interfaceId/,
    );
    const incomplete = validProposal();
    incomplete.interfaceContracts = [];
    assert.match(
      parseError(() =>
        validateContractSuiteProposal(
          parseContractSuiteProposal(incomplete),
          design as never,
          "profile-r1",
        ),
      ),
      /exactly one bundle for every semantic interface/,
    );
  });

  const twoInterfaceDesign = () => {
    const extended = JSON.parse(JSON.stringify(design));
    extended.interfaces.push({
      id: "calculator-api-secondary",
      subjectId: "product",
      name: "Calculator Secondary API",
      peer: "caller",
      visibility: "external",
      direction: "inbound",
      interactionStyle: "request_response",
      interactionIds: ["subtract"],
    });
    extended.interactions.push({
      id: "subtract",
      interfaceId: "calculator-api-secondary",
      name: "Subtract",
      intent: "Subtract two numbers",
      inputDescription: "Two numbers",
      outputDescription: "Their difference",
      failureDescriptions: [],
      stateEffects: [],
      requirementIds: ["req-1"],
      acceptanceCriteriaIds: ["ac-1"],
    });
    return extended;
  };

  it("rejects duplicate adapter programs across bundles", () => {
    const proposal = validProposal();
    const first = validProposal().interfaceContracts[0];
    proposal.interfaceContracts.push({
      interfaceId: "calculator-api-secondary",
      adapter: first.adapter,
      formalContract: first.formalContract,
      normalizedIndex: {
        interfaceId: "calculator-api-secondary",
        interactions: [{
          semanticInteractionId: "subtract",
          operationId: "subtract",
          inputSchema: { type: "object" },
          outputs: [{ id: "difference", description: "The difference", schema: { type: "number" } }],
          errors: [],
          nativeAnchors: ["contracts/calculator.ts#subtract"],
        }],
      },
    });
    const subject = proposal.subjectContracts[0];
    subject.interfaceIds = ["calculator-api", "calculator-api-secondary"];
    subject.protocol.transitions.push({
      id: "t-subtract",
      fromState: "idle",
      interactionId: "subtract",
      outcomeId: "difference",
      toState: "idle",
      description: "Subtracts two numbers",
    });
    subject.harness.interactions.push({
      interactionId: "subtract",
      invoke: "subtract(left, right)",
      observe: "return value",
    });
    assert.match(
      parseError(() =>
        validateContractSuiteProposal(
          parseContractSuiteProposal(proposal),
          twoInterfaceDesign() as never,
          "profile-r1",
        ),
      ),
      /Adapter programs contains duplicate id calculator-adapter/,
    );
  });

  it("requires subject protocols to bind their interface contracts and states", () => {
    const proposal = validProposal();
    proposal.subjectContracts[0].interfaceIds = [];
    assert.match(
      parseError(() =>
        validateContractSuiteProposal(
          parseContractSuiteProposal(proposal),
          design as never,
          "profile-r1",
        ),
      ),
      /does not bind all of its interface contracts/,
    );

    const unknownState = validProposal();
    unknownState.subjectContracts[0].protocol.initialState = "quantum";
    assert.match(
      parseError(() =>
        validateContractSuiteProposal(
          parseContractSuiteProposal(unknownState),
          design as never,
          "profile-r1",
        ),
      ),
      /unknown initial state/,
    );

    const duplicateStates = validProposal();
    duplicateStates.subjectContracts[0].protocol.states = ["idle", "idle"];
    assert.match(
      parseError(() =>
        validateContractSuiteProposal(
          parseContractSuiteProposal(duplicateStates),
          design as never,
          "profile-r1",
        ),
      ),
      /must not contain duplicates/,
    );

    const unknownTransitionState = validProposal();
    unknownTransitionState.subjectContracts[0].protocol.transitions[0].toState = "limbo";
    assert.match(
      parseError(() =>
        validateContractSuiteProposal(
          parseContractSuiteProposal(unknownTransitionState),
          design as never,
          "profile-r1",
        ),
      ),
      /references an unknown state/,
    );
  });

  it("pins protocol transitions to subject interactions and normalized outcomes", () => {
    const mutated = validProposal();
    mutated.subjectContracts[0].protocol.transitions[0].interactionId = "clock-tick";
    assert.match(
      parseError(() =>
        validateContractSuiteProposal(
          parseContractSuiteProposal(mutated),
          design as never,
          "profile-r1",
        ),
      ),
      /interaction outside its subject/,
    );

    const unknownOutcome = validProposal();
    unknownOutcome.subjectContracts[0].protocol.transitions[0].outcomeId = "mystery";
    assert.match(
      parseError(() =>
        validateContractSuiteProposal(
          parseContractSuiteProposal(unknownOutcome),
          design as never,
          "profile-r1",
        ),
      ),
      /references an unknown normalized outcome/,
    );
  });

  it("requires the harness to bind every subject interaction exactly once", () => {
    const proposal = validProposal();
    proposal.subjectContracts[0].harness.interactions = [];
    assert.match(
      parseError(() =>
        validateContractSuiteProposal(
          parseContractSuiteProposal(proposal),
          design as never,
          "profile-r1",
        ),
      ),
      /must bind every subject interaction exactly once/,
    );

    const doubled = validProposal();
    doubled.subjectContracts[0].harness.interactions = [
      { interactionId: "add", invoke: "add(left, right)", observe: "return value" },
      { interactionId: "add", invoke: "add(a, b)", observe: "return value" },
    ];
    assert.match(
      parseError(() =>
        validateContractSuiteProposal(
          parseContractSuiteProposal(doubled),
          design as never,
          "profile-r1",
        ),
      ),
      /must bind every subject interaction exactly once/,
    );
  });

  it("rejects harness factory kinds outside the supported set", () => {
    const proposal = validProposal();
    proposal.subjectContracts[0].harness.factoryKind = "summoning" as never;
    assert.match(
      parseError(() => parseContractSuiteProposal(proposal)),
      /factoryKind has an unsupported value/,
    );
  });

  it("requires one formal contract per verification obligation", () => {
    const proposal = validProposal();
    proposal.verificationContracts.push({
      verificationObligationId: "vo-ghost",
      environment: ["ci"],
      stimulus: ["Run"],
      evidenceSchema: { type: "object" },
      passMatchers: [{ kind: "schema" }],
    });
    assert.match(
      parseError(() =>
        validateContractSuiteProposal(
          parseContractSuiteProposal(proposal),
          design as never,
          "profile-r1",
        ),
      ),
      /exactly one formal contract per verification obligation/,
    );
  });
});
