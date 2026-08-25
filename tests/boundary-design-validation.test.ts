import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseBoundaryDesignProposal,
  validateBoundaryDesign,
} from "../app/contract-domain";

function parseError(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("Expected the validator to throw, but it succeeded.");
}

const validProposal = {
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
  coverage: [
    { acceptanceCriteriaId: "ac-1", targetType: "interaction", targetId: "add" },
  ],
};

const context = {
  requirementIds: new Set(["req-1"]),
  acceptanceCriteriaIds: new Set(["ac-1"]),
};

function parse(value: unknown) {
  return parseBoundaryDesignProposal(value);
}

function validate(value: unknown, overrides: Record<string, unknown> = {}) {
  const design = value as Record<string, unknown>;
  validateBoundaryDesign(
    { ...design, ...overrides } as never,
    context,
  );
}

describe("boundary design proposal parsing", () => {
  it("parses a complete proposal", () => {
    const proposal = parse(validProposal);
    assert.equal(proposal.rootSubjectId, "product");
    assert.equal(proposal.subjects.length, 1);
    assert.equal(proposal.interfaces.length, 1);
    assert.equal(proposal.interactions.length, 1);
    assert.equal(proposal.coverage.length, 1);
  });

  it("rejects non-objects and unknown keys at the top level", () => {
    assert.match(parseError(() => parse(42)), /must be an object/);
    assert.match(
      parseError(() => parse({ ...validProposal, extra: 1 })),
      /unsupported field "extra"/,
    );
  });

  it("enforces exact subject shape and enum values", () => {
    const withSubject = (subject: unknown) =>
      parse({ ...validProposal, subjects: [subject] });
    assert.match(
      parseError(() => withSubject({ ...validProposal.subjects[0], extra: 1 })),
      /subjects\[0\] contains unsupported field "extra"/,
    );
    assert.match(
      parseError(() => withSubject({ ...validProposal.subjects[0], classification: "magical" })),
      /classification has an unsupported value/,
    );
    assert.match(
      parseError(() => withSubject({ ...validProposal.subjects[0], lifecycle: "eternal" })),
      /lifecycle has an unsupported value/,
    );
    assert.match(
      parseError(() => withSubject({ ...validProposal.subjects[0], id: "bad id!" })),
      /subjects\[0\]\.id/,
    );
  });

  it("enforces exact interface and interaction shapes", () => {
    const withInterface = (iface: unknown) =>
      parse({ ...validProposal, interfaces: [iface] });
    assert.match(
      parseError(() => withInterface({ ...validProposal.interfaces[0], direction: "sideways" })),
      /direction has an unsupported value/,
    );
    assert.match(
      parseError(() => withInterface({ ...validProposal.interfaces[0], interactionStyle: "telepathy" })),
      /interactionStyle has an unsupported value/,
    );
    const withInteraction = (interaction: unknown) =>
      parse({ ...validProposal, interactions: [interaction] });
    assert.match(
      parseError(() => withInteraction({ ...validProposal.interactions[0], extra: true })),
      /interactions\[0\] contains unsupported field "extra"/,
    );
  });

  it("enforces verification obligation and coverage shapes", () => {
    assert.match(
      parseError(() => parse({
        ...validProposal,
        verificationObligations: [{
          id: "vo-1",
          name: "Fast enough",
          kind: "vibes",
          description: "Feels fast",
          requirementIds: [],
          acceptanceCriteriaIds: [],
        }],
      })),
      /kind has an unsupported value/,
    );
    assert.match(
      parseError(() => parse({
        ...validProposal,
        coverage: [{ acceptanceCriteriaId: "ac-1", targetType: "vibes", targetId: "add" }],
      })),
      /targetType has an unsupported value/,
    );
  });
});

describe("boundary design semantic validation", () => {
  it("accepts the valid design", () => {
    validate(validProposal);
  });

  it("rejects stale revisions and unknown root subjects", () => {
    assert.match(
      parseError(() => validateBoundaryDesign(
        { ...validProposal, requirementsRevisionId: "requirements-r2" } as never,
        { ...context, requirementsRevisionId: "requirements-r1" },
      )),
      /stale requirements revision/,
    );
    assert.match(
      parseError(() => validate({ ...validProposal, rootSubjectId: "ghost" })),
      /rootSubjectId must identify a subject/,
    );
  });

  it("enforces root subject rules", () => {
    const rooted = JSON.parse(JSON.stringify(validProposal));
    rooted.subjects[0].parentSubjectId = "product";
    assert.match(parseError(() => validate(rooted)), /root subject cannot have a parent/);
    rooted.subjects[0].parentSubjectId = null;
    rooted.subjects[0].classification = "internal";
    assert.match(parseError(() => validate(rooted)), /cannot be classified as internal/);
  });

  it("requires non-root subjects to have existing parents and justification", () => {
    const child = {
      id: "engine",
      name: "Engine",
      purpose: "Compute",
      classification: "internal",
      parentSubjectId: "product",
      responsibilities: [],
      exclusions: [],
      lifecycle: "fresh_per_case",
      requirementIds: [],
      acceptanceCriteriaIds: [],
    };
    const parentless = JSON.parse(JSON.stringify(validProposal));
    parentless.subjects.push({ ...child, parentSubjectId: null });
    assert.match(parseError(() => validate(parentless)), /must have an existing parent subject/);

    const unjustified = JSON.parse(JSON.stringify(validProposal));
    unjustified.subjects.push(child);
    assert.match(parseError(() => validate(unjustified)), /not justified by an upstream artifact/);

    const justified = JSON.parse(JSON.stringify(validProposal));
    justified.subjects.push({ ...child, requirementIds: ["req-1"] });
    validate(justified);
  });

  it("detects parent cycles", () => {
    const cyclic = JSON.parse(JSON.stringify(validProposal));
    cyclic.subjects.push(
      {
        id: "engine",
        name: "Engine",
        purpose: "Compute",
        classification: "internal",
        parentSubjectId: "gear",
        responsibilities: [],
        exclusions: [],
        lifecycle: "fresh_per_case",
        requirementIds: ["req-1"],
        acceptanceCriteriaIds: [],
      },
      {
        id: "gear",
        name: "Gear",
        purpose: "Turn",
        classification: "internal",
        parentSubjectId: "engine",
        responsibilities: [],
        exclusions: [],
        lifecycle: "fresh_per_case",
        requirementIds: ["req-1"],
        acceptanceCriteriaIds: [],
      },
    );
    assert.match(parseError(() => validate(cyclic)), /parent cycle/);
  });

  it("validates interface ownership and references", () => {
    assert.match(
      parseError(() => validate({
        ...validProposal,
        interfaces: [{ ...validProposal.interfaces[0], subjectId: "ghost" }],
      })),
      /references an unknown subject/,
    );
    assert.match(
      parseError(() => validate({
        ...validProposal,
        interfaces: [{ ...validProposal.interfaces[0], interactionIds: [] }],
      })),
      /must list exactly its owned interactions/,
    );
    assert.match(
      parseError(() => validate({
        ...validProposal,
        interactions: [
          validProposal.interactions[0],
          { ...validProposal.interactions[0], id: "subtract", name: "Subtract" },
        ],
      })),
      /must list exactly its owned interactions/,
    );
  });

  it("validates interaction interfaces and known artifact ids", () => {
    assert.match(
      parseError(() => validate({
        ...validProposal,
        interfaces: [{ ...validProposal.interfaces[0], interactionIds: [] }],
        interactions: [{ ...validProposal.interactions[0], interfaceId: "ghost-api" }],
      })),
      /references an unknown interface/,
    );
    assert.match(
      parseError(() => validate({
        ...validProposal,
        interactions: [{ ...validProposal.interactions[0], requirementIds: ["req-unknown"] }],
      })),
      /req-unknown/,
    );
  });

  it("validates coverage completeness and target claims", () => {
    assert.match(
      parseError(() => validate({
        ...validProposal,
        coverage: [{ acceptanceCriteriaId: "ac-unknown", targetType: "interaction", targetId: "add" }],
      })),
      /unknown acceptance criterion ac-unknown/,
    );
    assert.match(
      parseError(() => validate({
        ...validProposal,
        coverage: [{ acceptanceCriteriaId: "ac-1", targetType: "interaction", targetId: "ghost" }],
      })),
      /unknown interaction ghost/,
    );
    assert.match(
      parseError(() => validate({
        ...validProposal,
        interactions: [{ ...validProposal.interactions[0], acceptanceCriteriaIds: [] }],
      })),
      /does not claim criterion ac-1/,
    );
    assert.match(
      parseError(() => validate({
        ...validProposal,
        coverage: [],
      })),
      /has no verification coverage/,
    );
  });
});
