import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  extractTestCaseCode,
  generateTestAnnotation,
  getCommentSyntax,
  hydrateMissingLastGeneratedAt,
} from "../app/utilities/testParser";

describe("test-code annotations", () => {
  it("uses language-appropriate comments", () => {
    assert.deepEqual(getCommentSyntax(" Python "), { prefix: "#", suffix: "" });
    assert.deepEqual(getCommentSyntax("HTML"), {
      prefix: "<!--",
      suffix: "-->",
    });
    assert.deepEqual(getCommentSyntax("TypeScript"), {
      prefix: "//",
      suffix: "",
    });
  });

  it("extracts code with CRLF lines and regex characters in IDs", () => {
    const scenarioId = "scenario-1";
    const testCaseId = "case.[1]";
    const beginning = generateTestAnnotation(
      "typescript",
      "TC-1 - title",
      testCaseId,
      "beginning",
    );
    const end = generateTestAnnotation(
      "typescript",
      "TC-1 - title",
      testCaseId,
      "end",
    );
    const content = [
      `// TSC-SCENARIO - ${scenarioId}`,
      beginning,
      "expect(value).toBe(true);",
      end,
    ].join("\r\n");

    assert.equal(
      extractTestCaseCode(
        [{ path: "tests/scenario.test.ts", content }],
        scenarioId,
        testCaseId,
        "typescript",
      ),
      "expect(value).toBe(true);",
    );
  });

  it("hydrates generation metadata only when matching code exists", () => {
    const generated: number[] = [];
    const scenarios = [
      {
        id: "scenario",
        testCases: [
          {
            id: "case",
            lastGeneratedAt: null,
            lastModifiedAt: 123,
            setLastGeneratedAt: (timestamp: number) => generated.push(timestamp),
          },
        ],
      },
    ];
    const content = [
      "// TSC-SCENARIO - scenario",
      "// TC-1 - title - case - beginning",
      "test();",
      "// TC-1 - title - case - end",
    ].join("\n");

    hydrateMissingLastGeneratedAt(
      scenarios,
      [{ path: "tests/scenario.test.ts", content }],
      "typescript",
    );

    assert.deepEqual(generated, [123]);
  });
});
