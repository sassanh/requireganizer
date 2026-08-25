import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseTestCaseDefinition,
  parseTestCaseListProposal,
} from "../app/contract-domain";

function parseError(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("Expected the parser to throw, but it succeeded.");
}

const behavioralDefinition = {
  kind: "behavioral",
  scenarioRevisionId: "scenario-r1",
  subjectId: "calculator",
  initialFixture: {},
  boundaryRevisionId: "boundary-r1",
  interfaceContractRevisionIds: ["interface-r1"],
  subjectContractRevisionId: "subject-r1",
  trace: [
    { id: "input-1", kind: "input", correlationAlias: "addition-1", interfaceId: "api", interactionId: "add", payload: { left: 1, right: 2 }, captures: [{ name: "leftValue", pointer: "/payload/left" }] },
    { id: "output-1", kind: "output", correlationAlias: "addition-1", interfaceId: "api", interactionId: "add", outcomeId: "sum", matcher: { kind: "exact", value: { value: 3 } }, captures: [], withinMs: 500 },
  ],
};

const verificationDefinition = {
  kind: "verification",
  scenarioRevisionId: "scenario-r1",
  setup: ["Seed the database"],
  stimulus: ["Run the batch job"],
  evidence: ["Job log"],
  passMatchers: [{ kind: "exact", value: 1 }],
  verificationContractRevisionId: "verification-r1",
};

describe("test case definition parsing", () => {
  it("parses behavioral definitions with ordered trace events", () => {
    const definition = parseTestCaseDefinition(behavioralDefinition);
    assert.equal(definition.kind, "behavioral");
    assert.equal(definition.trace.length, 2);
    const output = definition.trace[1] as { matcher: { kind: string }; withinMs?: number };
    assert.equal(output.matcher.kind, "exact");
    assert.equal(output.withinMs, 500);
  });

  it("parses verification definitions", () => {
    const definition = parseTestCaseDefinition(verificationDefinition);
    assert.equal(definition.kind, "verification");
  });

  it("rejects unsupported kinds and unknown keys", () => {
    assert.match(
      parseError(() => parseTestCaseDefinition({ ...behavioralDefinition, kind: "psychic" })),
      /kind has an unsupported value/,
    );
    assert.match(
      parseError(() => parseTestCaseDefinition({ ...behavioralDefinition, extra: 1 })),
      /contains unsupported field "extra"/,
    );
    assert.match(
      parseError(() => parseTestCaseDefinition({ ...verificationDefinition, extra: 1 })),
      /contains unsupported field "extra"/,
    );
  });

  it("rejects malformed trace events", () => {
    const withTrace = (trace: unknown) =>
      parseTestCaseDefinition({ ...behavioralDefinition, trace });
    assert.match(
      parseError(() => withTrace([{ ...behavioralDefinition.trace[0], kind: "vibes" }])),
      /kind has an unsupported value/,
    );
    assert.match(
      parseError(() => withTrace([{ ...behavioralDefinition.trace[0], extra: 1 }])),
      /contains unsupported field "extra"/,
    );
    assert.match(
      parseError(() => withTrace([{ ...behavioralDefinition.trace[0], withinMs: 0 }])),
      /withinMs/,
    );
    assert.match(
      parseError(() => withTrace([{
        ...behavioralDefinition.trace[0],
        captures: [{ name: "bad", pointer: "not-a-pointer" }],
      }])),
      /must be a JSON Pointer/,
    );
  });

  it("validates portable matchers across every kind", () => {
    const withMatcher = (matcher: unknown) =>
      parseTestCaseDefinition({
        ...behavioralDefinition,
        trace: [{ ...behavioralDefinition.trace[1], matcher }],
      });

    assert.equal(
      (parseTestCaseDefinition({
        ...behavioralDefinition,
        trace: [{ ...behavioralDefinition.trace[1], matcher: { kind: "schema" } }],
      }) as { trace: { matcher: { kind: string } }[] }).trace[0].matcher.kind,
      "schema",
    );

    assert.equal(
      (parseTestCaseDefinition({
        ...behavioralDefinition,
        trace: [{ ...behavioralDefinition.trace[1], matcher: { kind: "presence", pointer: "/body/sum", present: true } }],
      }) as { trace: { matcher: { kind: string } }[] }).trace[0].matcher.kind,
      "presence",
    );

    assert.equal(
      (parseTestCaseDefinition({
        ...behavioralDefinition,
        trace: [{ ...behavioralDefinition.trace[1], matcher: { kind: "unordered_list", pointer: "/body/items", items: [1, 2] } }],
      }) as { trace: { matcher: { kind: string } }[] }).trace[0].matcher.kind,
      "unordered_list",
    );

    assert.match(
      parseError(() => withMatcher({ kind: "exact", value: 1, extra: 1 })),
      /contains unsupported field "extra"/,
    );
    assert.match(
      parseError(() => withMatcher({ kind: "presence", pointer: "/x" })),
      /matcher.present must be true or false/,
    );
    assert.match(
      parseError(() => withMatcher({ kind: "range", pointer: "/x" })),
      /must define minimum or maximum/,
    );
    assert.match(
      parseError(() => withMatcher({ kind: "range", pointer: "/x", minimum: 5, maximum: 1 })),
      /minimum cannot exceed maximum/,
    );
    assert.match(
      parseError(() => withMatcher({ kind: "regex", pointer: "/x", pattern: "(?=lookahead)" })),
      /pattern is not resource-safe/,
    );
    assert.match(
      parseError(() => withMatcher({ kind: "regex", pointer: "/x", pattern: "(a)\\1" })),
      /pattern is not resource-safe/,
    );
    assert.match(
      parseError(() => withMatcher({ kind: "mystery" })),
      /kind has an unsupported value/,
    );
  });
});

describe("test case list proposal parsing", () => {
  const item = {
    key: "case-1",
    title: "Adds numbers",
    description: "Adds two numbers",
    priority: "p0",
    acceptanceCriteriaIds: ["ac-1"],
    definition: behavioralDefinition,
    dependencies: [],
  };

  it("parses a valid list and records the scenario id", () => {
    const proposal = parseTestCaseListProposal({ items: [item] }, "scenario-1");
    assert.equal(proposal.scenarioId, "scenario-1");
    assert.equal(proposal.items.length, 1);
    assert.equal(proposal.items[0].definition.kind, "behavioral");
  });

  it("enforces the proposal graph: keys, preserved ids, dependencies", () => {
    assert.match(
      parseError(() => parseTestCaseListProposal({ items: [item, item] }, "scenario-1")),
      /contains duplicate key case-1/,
    );
    assert.match(
      parseError(() => parseTestCaseListProposal(
        { items: [item, { ...item, key: "case-2", id: "ghost" }] },
        "scenario-1",
      )),
      /attempts to preserve unknown id ghost/,
    );
    assert.match(
      parseError(() => parseTestCaseListProposal(
        { items: [{ ...item, id: "existing" }, { ...item, key: "case-2", id: "existing" }] },
        "scenario-1",
        ["existing"],
      )),
      /preserves id existing more than once/,
    );
    assert.match(
      parseError(() => parseTestCaseListProposal(
        { items: [item, { ...item, key: "case-2", dependencies: ["case-3"] }] },
        "scenario-1",
      )),
      /depends on unknown key case-3/,
    );
    assert.match(
      parseError(() => parseTestCaseListProposal(
        { items: [{ ...item, dependencies: ["case-1"] }] },
        "scenario-1",
      )),
      /cannot depend on itself/,
    );
    assert.match(
      parseError(() => parseTestCaseListProposal(
        {
          items: [
            { ...item, key: "case-1", dependencies: ["case-2"] },
            { ...item, key: "case-2", dependencies: ["case-1"] },
          ],
        },
        "scenario-1",
      )),
      /dependency cycle/,
    );
  });
});
