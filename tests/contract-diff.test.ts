import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatContractSuiteDiff } from "../app/contract-domain";
import type { ContractSuite } from "../app/contract-domain";

function suite(summary: string, revisionId: string): ContractSuite {
  return {
    id: "suite",
    revisionId,
    revision: revisionId === "suite-r1" ? 1 : 2,
    createdAt: "2026-08-13T00:00:00.000Z",
    boundaryRevisionId: "boundary-r1",
    profileRevisionId: "profile-r1",
    interfaceContracts: [{
      id: "interface-contract",
      revisionId: `${revisionId}-interface`,
      revision: 1,
      status: revisionId === "suite-r1" ? "approved" : "draft",
      createdAt: "2026-08-13T00:00:00.000Z",
      interfaceId: "calculator-api",
      boundaryRevisionId: "boundary-r1",
      profileRevisionId: "profile-r1",
      adapter: {
        id: "adapter",
        version: "1",
        notation: "JSON Schema",
        rationale: "Portable",
        formalizationInstructions: ["Preserve operation IDs."],
        revisionInstructions: ["Revise the complete contract."],
        toolSchemas: { formalContract: true, traceEvent: true },
      },
      formalContract: {
        format: "manifest",
        summary,
        documents: [],
        neutralManifest: null,
      },
      normalizedIndex: { interfaceId: "calculator-api", interactions: [] },
    }],
    subjectContracts: [],
    verificationContracts: [],
  };
}

describe("contract artifact diff", () => {
  it("reports material changes without revision bookkeeping noise", () => {
    const result = formatContractSuiteDiff(
      suite("Adds two values.", "suite-r1"),
      suite("Adds decimal values.", "suite-r2"),
    );

    assert.match(result, /\/formalContract\/summary/);
    assert.ok(result.includes('- /interfaceContracts/interfaceId=calculator-api/formalContract/summary: "Adds two values."'));
    assert.ok(result.includes('+ /interfaceContracts/interfaceId=calculator-api/formalContract/summary: "Adds decimal values."'));
    assert.doesNotMatch(result, /suite-r2-interface/);
    assert.doesNotMatch(result, /\/status/);
  });
});
