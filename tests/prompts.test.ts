import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildArtifactStagePrompt,
  buildFragmentRevisionPrompt,
  buildProductOverviewPrompt,
  buildSystemPrompt,
  buildTestCodePrompt,
} from "../app/ai-harness/prompts";
import { getArtifactStageDefinition } from "../app/ai-harness/workflow";
import {
  EngineerRole,
  StructuralFragment,
} from "../app/store/constants";

function assertBefore(text: string, first: string, second: string): void {
  const firstIndex = text.indexOf(first);
  const secondIndex = text.indexOf(second);
  assert.notEqual(firstIndex, -1, `Missing ${first}.`);
  assert.notEqual(secondIndex, -1, `Missing ${second}.`);
  assert.ok(firstIndex < secondIndex, `${first} must precede ${second}.`);
}

describe("cache-friendly prompt layout", () => {
  it("keeps the system policy stable before assignment-specific values", () => {
    const first = buildSystemPrompt({
      operation: "generate user stories",
      role: EngineerRole.RequirementsEngineer,
    });
    const second = buildSystemPrompt({
      operation: "generate test code",
      role: EngineerRole.SoftwareTestEngineer,
    });
    const assignmentMarker = "Current assignment:";
    const firstPrefix = first.slice(0, first.indexOf(assignmentMarker));
    const secondPrefix = second.slice(0, second.indexOf(assignmentMarker));

    assert.equal(firstPrefix, secondPrefix);
    assert.ok(firstPrefix.length > 1_000);
    assertBefore(first, "Operating rules:", assignmentMarker);
  });

  it("places reusable operation contracts before request data", () => {
    const state = { description: "Dynamic project description." };
    const artifactPrompt = buildArtifactStagePrompt({
      definition: getArtifactStageDefinition(StructuralFragment.AcceptanceCriteria),
      state,
    });

    const prompts: Array<[string, string, string]> = [
      [buildProductOverviewPrompt(state), '"qualityRules"', '"projectContext"'],
      [artifactPrompt, '"mutationRules"', '"target"'],
      [
        buildFragmentRevisionPrompt({
          state,
          entityType: StructuralFragment.Requirement,
          id: "requirement-id",
          comment: "Dynamic feedback.",
        }),
        '"rules"',
        '"target"',
      ],
      [
        buildTestCodePrompt({
          request: {
            project: {
              name: "Project",
              purpose: "Purpose",
              framework: "Next.js",
              language: "TypeScript",
            },
            projectConfig: {},
            contracts: {},
            scaffoldManifest: {},
            bindingMetadata: {
              adapterIds: [],
              interfaceContractRevisionIds: [],
              subjectContractRevisionIds: [],
            },
            scenario: {
              id: "scenario-id",
              revisionId: "scenario-r1",
              code: "TSC-1",
              content: "Scenario",
              binding: {
                kind: "behavioral",
                subjectId: "product",
                interfaceIds: ["api"],
                boundaryRevisionId: "boundary-r1",
                interfaceContractRevisionIds: ["interface-r1"],
                subjectContractRevisionId: "subject-r1",
              },
            },
            testCase: {
              id: "case-id",
              revisionId: "case-r1",
              code: "TC-1",
              title: "Case",
              definition: {
                kind: "behavioral",
                scenarioRevisionId: "scenario-r1",
                subjectId: "product",
                initialFixture: {},
                trace: [],
                boundaryRevisionId: "boundary-r1",
                interfaceContractRevisionIds: ["interface-r1"],
                subjectContractRevisionId: "subject-r1",
              },
              renderedSteps: "Steps",
              renderedExpectedResult: "Result",
            },
            targetPath: "tests/scenario.test.ts",
            existingFile: null,
          },
          scenarioAnnotation: "// scenario",
          beginAnnotation: "// begin",
          endAnnotation: "// end",
          protectedTestCaseIds: [],
        }),
        '"rules"',
        '"requiredAnnotations"',
      ],
    ];

    for (const [prompt, stableField, firstDynamicField] of prompts) {
      assertBefore(prompt, stableField, firstDynamicField);
    }
    assertBefore(artifactPrompt, '"mutationRules"', '"target"');
    assertBefore(artifactPrompt, '"target"', '"projectContext"');
  });
});
