"use server";
import "server-only";

import { runStructuredHarnessTask } from "actions/lib/harness";
import { TestCodeRequest } from "ai-harness/contracts";
import {
  buildSystemPrompt,
  buildTestCodePrompt,
} from "ai-harness/prompts";
import {
  assertValidGeneratedTestCode,
  collectProtectedTestBlocks,
} from "ai-harness/test-code";
import { buildTestCodeTool } from "ai-harness/tools";
import {
  parseTestCodeProposal,
  parseTestCodeRequest,
} from "ai-harness/validation";
import { EngineerRole } from "store/constants";
import { generateTestAnnotation } from "utilities/testParser";

export async function generateTestCode(request: TestCodeRequest) {
  const validatedRequest = parseTestCodeRequest(request);
  const targetPath = validatedRequest.targetPath;

  const language = validatedRequest.project.language;
  const scenarioAnnotation = generateTestAnnotation(
    language,
    "",
    validatedRequest.scenario.id,
    "scenario",
  );
  const codeAndTitle = `${validatedRequest.testCase.code} - ${validatedRequest.testCase.title}`;
  const beginAnnotation = generateTestAnnotation(
    language,
    codeAndTitle,
    validatedRequest.testCase.id,
    "beginning",
  );
  const endAnnotation = generateTestAnnotation(
    language,
    codeAndTitle,
    validatedRequest.testCase.id,
    "end",
  );
  const protectedBlocks = collectProtectedTestBlocks(
    validatedRequest.existingFile?.content,
    validatedRequest.testCase.id,
  );
  const operation = validatedRequest.comment
    ? "revise test code"
    : "generate test code";

  return runStructuredHarnessTask({
    operation,
    systemPrompt: buildSystemPrompt({
      operation,
      role: EngineerRole.SoftwareTestEngineer,
    }),
    userPrompt: buildTestCodePrompt({
      request: validatedRequest,
      scenarioAnnotation,
      beginAnnotation,
      endAnnotation,
      protectedTestCaseIds: protectedBlocks.map(({ id }) => id),
    }),
    resultTool: buildTestCodeTool(),
    bindingMetadata: validatedRequest.bindingMetadata,
    parseResult: (value) => {
      const proposal = parseTestCodeProposal(value, targetPath);
      assertValidGeneratedTestCode({
        code: proposal.code,
        scenarioAnnotation,
        beginAnnotation,
        endAnnotation,
        protectedBlocks,
      });
      return proposal;
    },
  });
}
