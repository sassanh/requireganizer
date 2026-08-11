import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  InvalidJsonError,
  parseJsonc,
  parseJsoncObject,
  stripJsoncComments,
} from "../app/lib/json";

describe("JSONC parsing", () => {
  it("preserves comment markers inside strings", () => {
    const value = parseJsoncObject(`{
      // Service endpoint
      "url": "https://example.com/a//b",
      "pattern": "/* literal */"
    }`);

    assert.deepEqual(value, {
      url: "https://example.com/a//b",
      pattern: "/* literal */",
    });
  });

  it("supports block comments and trailing commas", () => {
    const value = parseJsonc(`{
      /* supported options */
      "items": ["one", "two",],
      "nested": { "enabled": true, },
    }`);

    assert.deepEqual(value, {
      items: ["one", "two"],
      nested: { enabled: true },
    });
  });

  it("preserves line breaks while removing comments", () => {
    const source = "{\n  // comment\n  \"ok\": true\n}";
    assert.equal(stripJsoncComments(source).split("\n").length, 4);
  });

  it("rejects unterminated block comments", () => {
    assert.throws(
      () => parseJsonc("{ /* unfinished"),
      (error: unknown) => error instanceof InvalidJsonError,
    );
  });

  it("rejects non-object configuration values", () => {
    assert.throws(
      () => parseJsoncObject("[]", "Configuration"),
      /Configuration must be a JSON object/,
    );
  });
});
