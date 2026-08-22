import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  BoundaryDesign,
  ContractSuite,
  ContractSuiteProposal,
  ImplementationProfile,
} from "../app/contract-domain";
import { materializeContractSuite } from "../app/store/actions/ai-actions/utilities";

const createdAt = "2026-08-13T00:00:00.000Z";
const design = {
  id: "boundary",
  revisionId: "boundary-r1",
  revision: 1,
  status: "approved",
  createdAt,
  requirementsRevisionId: "requirements-r1",
  acceptanceCriteriaRevisionId: "criteria-r1",
  rootSubjectId: "product",
  subjects: [],
  interfaces: [],
  interactions: [],
  verificationObligations: [],
  coverage: [],
} as BoundaryDesign;
const profile: ImplementationProfile = {
  id: "profile",
  revisionId: "profile-r1",
  revision: 1,
  status: "approved",
  createdAt,
  boundaryRevisionId: design.revisionId,
  platform: "Web",
  runtime: "Node.js",
  language: "TypeScript",
  framework: "None",
  moduleSystem: "ES modules",
  buildEcosystem: "pnpm",
  testEcosystem: "node:test",
  constraints: [],
};
const proposal: ContractSuiteProposal = {
  interfaceContracts: [{
    interfaceId: "api",
    adapter: {
      id: "api-adapter",
      version: "1.0.0",
      notation: "JSON Schema",
      rationale: "Portable",
      formalizationInstructions: ["Preserve operation IDs."],
      revisionInstructions: ["Return a complete bundle."],
      toolSchemas: { formalContract: true, traceEvent: true },
    },
    formalContract: {
      format: "neutral",
      summary: "Stable API contract",
      documents: [],
      neutralManifest: { operations: [] },
    },
    normalizedIndex: { interfaceId: "api", interactions: [] },
  }],
  subjectContracts: [{
    subjectId: "product",
    interfaceIds: ["api"],
    protocol: { initialState: "ready", states: ["ready"], transitions: [], orderingRules: [] },
    harness: {
      moduleSpecifier: "product",
      subjectType: "Product",
      factoryKind: "factory",
      freshInstance: "createProduct()",
      resetStrategy: "Create a fresh subject",
      fixtureSchema: true,
      interactions: [],
    },
  }],
  verificationContracts: [],
};
const previous: ContractSuite = {
  id: "suite",
  revisionId: "suite-r1",
  revision: 1,
  createdAt,
  boundaryRevisionId: design.revisionId,
  profileRevisionId: profile.revisionId,
  interfaceContracts: [{
    id: "interface-bundle",
    revisionId: "interface-r1",
    revision: 1,
    status: "approved",
    createdAt,
    interfaceId: "api",
    boundaryRevisionId: design.revisionId,
    profileRevisionId: profile.revisionId,
    adapter: proposal.interfaceContracts[0].adapter,
    formalContract: {
      ...proposal.interfaceContracts[0].formalContract,
      documents: [],
    },
    normalizedIndex: proposal.interfaceContracts[0].normalizedIndex,
  }],
  subjectContracts: [{
    id: "subject-bundle",
    revisionId: "subject-r1",
    revision: 1,
    status: "approved",
    createdAt,
    subjectId: "product",
    boundaryRevisionId: design.revisionId,
    profileRevisionId: profile.revisionId,
    interfaceContractRevisionIds: ["interface-r1"],
    protocol: proposal.subjectContracts[0].protocol,
    harness: proposal.subjectContracts[0].harness,
  }],
  verificationContracts: [],
};

describe("contract-suite materialization", () => {
  it("preserves approved bundle revisions when their content is unchanged", () => {
    const result = materializeContractSuite(proposal, design, profile, previous);

    assert.equal(result.interfaceContracts[0].revisionId, "interface-r1");
    assert.equal(result.interfaceContracts[0].status, "approved");
    assert.equal(result.subjectContracts[0].revisionId, "subject-r1");
    assert.equal(result.subjectContracts[0].status, "approved");
  });

  it("revises a changed interface and its revision-bound subject bundle", () => {
    const result = materializeContractSuite({
      ...proposal,
      interfaceContracts: [{
        ...proposal.interfaceContracts[0],
        formalContract: {
          ...proposal.interfaceContracts[0].formalContract,
          summary: "Changed API contract",
        },
      }],
    }, design, profile, previous);

    assert.notEqual(result.interfaceContracts[0].revisionId, "interface-r1");
    assert.equal(result.interfaceContracts[0].status, "approved");
    assert.notEqual(result.subjectContracts[0].revisionId, "subject-r1");
    assert.equal(result.subjectContracts[0].status, "approved");
  });
});
