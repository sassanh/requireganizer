import { toGenerator } from "mobx-state-tree";

import { generateTestCode as generateTestCodeAction } from "actions/ai/generate-test-code";
import { Step } from "store";
import { TestCase, TestScenario } from "store/models";

import { generator } from "./utilities";

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
        self.resetValidationErrors();

        self.resetValidationErrors();

        const scenarioCode = testScenario.getCode();
        const existingFiles = self.scaffoldFiles.filter(f => f.content.includes(`TSC-SCENARIO - ${testScenario.id}`));

        if (existingFiles.length > 1) {
            alert(`Multiple test files found with same scenario UUID ${testScenario.id}. Please manually clean them up in the Code Viewer.`);
            throw new Error(`Multiple test files found with same scenario UUID.`);
        }

        let targetPath = "";
        if (existingFiles.length === 1) {
            const existingFile = existingFiles[0];
            const oldPath = existingFile.path;

            const lastSlash = oldPath.lastIndexOf("/");
            const dir = lastSlash > -1 ? oldPath.substring(0, lastSlash + 1) : "tests/";
            const filename = oldPath.substring(lastSlash + 1);
            const firstDot = filename.indexOf(".");
            const ext = firstDot > -1 ? filename.substring(firstDot) : ".test.ts";

            targetPath = `${dir}${scenarioCode}${ext}`;

            if (oldPath !== targetPath) {
                const content = existingFile.content;
                self.removeScaffoldFile(oldPath);
                self.setScaffoldFile(targetPath, content);
            }
        } else {
            const lang = (self.productOverview.programmingLanguage || "typescript").toLowerCase();
            const extensionMap: Record<string, string> = {
                javascript: ".test.js", typescript: ".test.ts", python: ".py",
                ruby: "_spec.rb", go: "_test.go", java: "Test.java",
                csharp: "Tests.cs", php: "Test.php", rust: ".rs",
                swift: "Tests.swift"
            };
            const ext = extensionMap[lang] || ".test.ts";
            targetPath = `tests/${scenarioCode}${ext}`;
        }

        const { code, path } = yield* toGenerator(
            generateTestCodeAction({
                state: self.json(Step.TestCases),
                testCaseId: testCase.id,
                testScenarioId: testScenario.id,
                targetPath,
                testCaseCodeStr: testCase.getCode(),
                testCaseTitle: testCase.title || "TestCase",
                testCaseContent: `Title: ${testCase.title}\nSteps:\n${testCase.steps}\nExpected Result: ${testCase.expectedResult}`,
                testScenarioContent: testScenario.content,
                comment,
            }),
        );

        if (path) {
            self.setScaffoldFile(path, code);
            testCase.setLastGeneratedAt(Date.now());
        }
    },
    {
        requirements: ["description", "productOverview", "testScenarios"],
    },
);
