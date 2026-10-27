import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { needsAiSettingsPrompt } from "../app/lib/aiSettingsPrompt";

describe("AI settings prompt", () => {
  it("asks the browser build for a key only when it has none", () => {
    assert.equal(needsAiSettingsPrompt("page", ""), true);
    assert.equal(needsAiSettingsPrompt("page", "   "), true);
    assert.equal(needsAiSettingsPrompt("page", " key "), false);
    // A server build takes the key from its environment.
    assert.equal(needsAiSettingsPrompt("server", ""), false);
  });
});
