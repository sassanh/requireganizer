"use server";
import "server-only";

import { GoogleGenAI } from "@google/genai";

import { generateTestAnnotation } from "utilities/testParser";

export async function generateTestCode({
    state,
    testCaseId,
    testScenarioId,
    targetPath,
    testCaseCodeStr,
    testCaseTitle,
    testCaseContent,
    testScenarioContent,
    comment,
}: {
    state: string;
    testCaseId: string;
    testScenarioId: string;
    targetPath: string;
    testCaseCodeStr: string;
    testCaseTitle: string;
    testCaseContent: string;
    testScenarioContent: string;
    comment?: string;
}): Promise<{ path?: string; code: string }> {
    const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

    const parsed = JSON.parse(state);
    const projectConfig = parsed.projectConfig;
    const scaffoldFiles = parsed.scaffoldFiles;

    const prompt = comment
        ? `You previously generated the following test code for the test case below (ID: ${testCaseId}):

${testCaseContent}

The user has the following feedback. Apply their requested changes:
"${comment}"

Current test code that needs modification:
(See the test case's current code in the state below)

${state}`
        : `Generate test code for the following test case.

Test Scenario: ${testScenarioContent}
Test Case: ${testCaseContent}
Test Case ID: ${testCaseId}

Project Configuration:
${projectConfig ? JSON.stringify(projectConfig, null, 2) : "Not configured yet"}

Current Virtual Filesystem (scaffoldFiles):
${scaffoldFiles ? JSON.stringify(scaffoldFiles, null, 2) : "No files generated yet"}

Framework: ${parsed.productOverview?.framework || "Unknown"}
Language: ${parsed.productOverview?.programmingLanguage || "Unknown"}
Test Framework: ${projectConfig?.testFramework || "Use the most appropriate for the language/framework"}

Full project state for context:
${state}`;

    const programmingLanguage = parsed.productOverview?.programmingLanguage || "typescript";
    const codeAndTitle = `${testCaseCodeStr} - ${testCaseTitle}`;
    const scenarioComment = generateTestAnnotation(programmingLanguage, "", testScenarioId, "scenario");
    const beginComment = generateTestAnnotation(programmingLanguage, codeAndTitle, testCaseId, "beginning");
    const endComment = generateTestAnnotation(programmingLanguage, codeAndTitle, testCaseId, "end");

    const result = await client.models.generateContent({
        model: "gemini-2.5-flash",
        config: {
            responseMimeType: "application/json",
            systemInstruction: `You are a Software Test Engineer writing test code. You must reply strictly with a JSON object containing exactly two keys: "path" and "code".`,
        },
        contents: [
            {
                role: "user",
                parts: [
                    {
                        text: `${prompt}

Rules:
- You must reply with a valid JSON object.
- "path": The requested file path. CRITICAL FILE NAMING: The filename MUST EXACTLY BE "${targetPath}". Do not deviate from this path naming whatsoever.
- "code": The raw test code.
- Write clear, readable test code adhering to best practices for the chosen framework and language.
- CRITICAL SCENARIO ANNOTATION: The very first line of the file MUST be exactly this comment. Do not modify it. (If merging into an existing file, ensure this comment remains at the top):
${scenarioComment}

- CRITICAL CODE FORMATTING: You MUST wrap the actual test case logic block exactly in these two comments. Do not modify the comments.
${beginComment}
// ... your test case ...
${endComment}

- CRITICAL MERGING RULES: Review the 'scaffoldFiles' array in the provided 'state' JSON. Find any existing file whose content contains the exact string "TSC-SCENARIO - ${testScenarioId}". If an existing file is found for this scenario, you MUST reuse it and merge tightly into its original code. DO NOT overwrite the file from scratch if it already exists, merge natively.
- JSON keys must be strictly "path" and "code".`,
                    },
                ],
            },
        ],
    });

    const text = result.text?.trim() ?? "{}";
    // Strip markdown fences if present
    const cleaned = text
        .replace(/^```(?:json)?\n?/i, "")
        .replace(/\n?```$/i, "")
        .trim();

    try {
        const parsed = JSON.parse(cleaned);
        return {
            path: parsed.path,
            code: parsed.code || cleaned,
        };
    } catch (e) {
        // Fallback
        return { code: cleaned };
    }
}
