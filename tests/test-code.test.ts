import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertValidGeneratedTestCode,
  collectProtectedTestBlocks,
} from "../app/ai-harness/test-code";

const scenarioAnnotation = "// TSC-SCENARIO - scenario-1";
const currentBeginning = "// TC-1 - Current - case-current - beginning";
const currentEnd = "// TC-1 - Current - case-current - end";
const otherBeginning = "// TC-2 - Other - case-other - beginning";
const otherEnd = "// TC-2 - Other - case-other - end";

const existingCode = [
  scenarioAnnotation,
  "import { test } from \"node:test\";",
  currentBeginning,
  "test(\"current\", () => {});",
  currentEnd,
  otherBeginning,
  "test(\"other\", () => {});",
  otherEnd,
].join("\n") + "\n";

describe("generated test-code protection", () => {
  it("accepts an exact unrelated test block", () => {
    const protectedBlocks = collectProtectedTestBlocks(
      existingCode,
      "case-current",
    );

    assert.deepEqual(protectedBlocks.map(({ id }) => id), ["case-other"]);
    assert.doesNotThrow(() =>
      assertValidGeneratedTestCode({
        code: existingCode,
        scenarioAnnotation,
        beginAnnotation: currentBeginning,
        endAnnotation: currentEnd,
        protectedBlocks,
      }),
    );
  });

  it("rejects even a small mutation to an unrelated test block", () => {
    const protectedBlocks = collectProtectedTestBlocks(
      existingCode,
      "case-current",
    );
    const changed = existingCode.replace(
      'test("other", () => {});',
      'test("other changed", () => {});',
    );

    assert.throws(
      () =>
        assertValidGeneratedTestCode({
          code: changed,
          scenarioAnnotation,
          beginAnnotation: currentBeginning,
          endAnnotation: currentEnd,
          protectedBlocks,
        }),
      /did not preserve.*case-other.*byte-for-byte/,
    );
  });

  it("rejects duplicate current annotations", () => {
    assert.throws(
      () =>
        assertValidGeneratedTestCode({
          code: `${existingCode}\n${currentBeginning}`,
          scenarioAnnotation,
          beginAnnotation: currentBeginning,
          endAnnotation: currentEnd,
          protectedBlocks: [],
        }),
      /exactly once/,
    );
  });
});
