import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Priority } from "../app/store/constants";
import { TestCaseModel } from "../app/store/models/TestCase";
import { TestScenarioModel } from "../app/store/models/TestScenario";

const definition = {
  kind: "behavioral" as const,
  scenarioRevisionId: "scenario-r1",
  subjectId: "calculator",
  initialFixture: {},
  boundaryRevisionId: "boundary-r1",
  interfaceContractRevisionIds: ["interface-r1"],
  subjectContractRevisionId: "subject-r1",
  trace: [
    { id: "input-1", kind: "input" as const, correlationAlias: "addition-1", interfaceId: "api", interactionId: "add", payload: { left: 1, right: 2 }, captures: [] },
    { id: "output-1", kind: "output" as const, correlationAlias: "addition-1", interfaceId: "api", interactionId: "add", outcomeId: "sum", matcher: { kind: "exact" as const, value: { value: 3 } }, captures: [] },
  ],
};

describe("structured test-case state", () => {
  it("marks generated output against an exact structured-input fingerprint", () => {
    const testCase = TestCaseModel.create({
      id: "case-1",
      content: "Adds values",
      title: "Adds two values",
      description: "Adds values",
      definition,
      priority: Priority.P0,
      references: [],
      dependencies: [],
    });
    assert.equal(testCase.testStatus, "not-generated");
    testCase.markGenerated(testCase.inputFingerprint!);
    assert.equal(testCase.testStatus, "generated");
    testCase.clearGenerated();
    assert.equal(testCase.testStatus, "not-generated");
    testCase.markGenerated(testCase.inputFingerprint!);
    testCase.setDefinition({ ...definition, initialFixture: { mode: "decimal" } });
    assert.equal(testCase.testStatus, "out-of-sync");
  });

  it("retains nested structured cases when scenario metadata changes", () => {
    const scenario = TestScenarioModel.create({
      id: "scenario-1",
      content: "Original scenario",
      description: "Original",
      priority: Priority.P0,
      references: [],
      dependencies: [],
      testCases: [{
        id: "case-1",
        content: "Adds values",
        title: "Existing case",
        description: "Adds values",
        definition,
        priority: Priority.P0,
        references: [],
        dependencies: [],
      }],
    });
    scenario.setContent("Revised scenario");
    assert.equal(scenario.testCases.length, 1);
    assert.equal(scenario.testCases[0].definition?.kind, "behavioral");
  });
});
