import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildArtifactStagePrompt,
  buildFragmentRevisionPrompt,
  buildProductOverviewPrompt,
  buildProjectConfigurationPrompt,
  buildScaffoldPrompt,
  buildSystemPrompt,
  buildTestCodePrompt,
} from "../app/ai-harness/prompts";
import { getArtifactStageDefinition } from "../app/ai-harness/workflow";
import {
  EngineerRole,
  Framework,
  ProgrammingLanguage,
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
      definition: getArtifactStageDefinition(StructuralFragment.TestCase),
      state,
      parentId: "scenario-id",
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
      [buildProjectConfigurationPrompt(state), '"rules"', '"projectContext"'],
      [
        buildScaffoldPrompt({ state, config: { testFramework: "node:test" } }),
        '"rules"',
        '"projectContext"',
      ],
      [
        buildTestCodePrompt({
          request: {
            project: {
              name: "Project",
              purpose: "Purpose",
              framework: Framework.NextJS,
              programmingLanguage: ProgrammingLanguage.TypeScript,
            },
            projectConfig: {},
            scenario: { id: "scenario-id", code: "TSC-1", content: "Scenario" },
            testCase: {
              id: "case-id",
              code: "TC-1",
              title: "Case",
              steps: "Steps",
              expectedResult: "Result",
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
