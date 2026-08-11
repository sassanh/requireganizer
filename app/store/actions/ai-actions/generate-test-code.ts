import { toGenerator } from "mobx-state-tree";

import { generateTestCode as generateTestCodeAction } from "actions/ai/generate-test-code";
import { getScenarioTestPath } from "ai-harness/capabilities";
import { UserFacingError } from "lib/errors";
import { parseJsoncObject } from "lib/json";
import { Step } from "store";
import { TestCase, TestScenario } from "store/models";

import {
  applyTestCodeProposal,
  consumeHarnessResult,
  generator,
} from "./utilities";

export default generator(
  function* generateTestCode(
    self,
    {
      testCase,
      testScenario,
      comment,
    }: {
      testCase: TestCase;
      testScenario: TestScenario;
      comment?: string;
    },
  ) {
    if (self.isProjectConfigOutdated) {
      throw new UserFacingError(
        "The specification changed. Regenerate the project configuration before generating test code.",
      );
    }
    const existingFiles = self.scaffoldFiles.filter((file) =>
      file.content.includes(`TSC-SCENARIO - ${testScenario.id}`),
    );
    if (existingFiles.length > 1) {
      throw new UserFacingError(
        `Multiple test files reference ${testScenario.getCode()}. Remove the duplicate and try again.`,
      );
    }

    const { framework, programmingLanguage, name, purpose } =
      self.productOverview;
    if (
      framework == null ||
      programmingLanguage == null ||
      name == null ||
      purpose == null
    ) {
      throw new UserFacingError(
        "Complete the product overview before generating test code.",
      );
    }
    if (self.projectConfig == null) {
      throw new UserFacingError(
        "Generate the project configuration before generating test code.",
      );
    }

    const targetPath =
      existingFiles[0]?.path ??
      getScenarioTestPath(
        testScenario.getCode(),
        testScenario.id,
        programmingLanguage,
      );
    const result = yield* toGenerator(
      generateTestCodeAction({
        project: {
          name,
          purpose,
          framework,
          programmingLanguage,
        },
        projectConfig: parseJsoncObject(
          self.projectConfig,
          "Project configuration",
        ),
        scenario: {
          id: testScenario.id,
          code: testScenario.getCode(),
          content: testScenario.content,
        },
        testCase: {
          id: testCase.id,
          code: testCase.getCode(),
          title: testCase.title,
          steps: testCase.steps,
          expectedResult: testCase.expectedResult,
        },
        targetPath,
        existingFile: existingFiles[0]
          ? {
            path: existingFiles[0].path,
            content: existingFiles[0].content,
          }
          : null,
        comment,
      }),
    );

    const proposal = consumeHarnessResult(self, result);
    if (proposal == null) return;
    applyTestCodeProposal(self, proposal, testCase.id);
  },
  {
    operation: "generate test code",
    requirements: [
      "description",
      "productOverview",
      "testScenarios",
      "projectConfig",
      "projectConfigLocked",
    ],
    requiredSteps: [Step.TestCases],
  },
);
