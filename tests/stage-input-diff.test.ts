import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { summarizeInputChanges } from "../app/store/stageInputDiff";

describe("input change summary", () => {
  it("reports nothing when nothing changed", () => {
    assert.deepEqual(summarizeInputChanges([]), []);
  });

  it("names a rewritten overview field with both texts", () => {
    assert.deepEqual(
      summarizeInputChanges([{
        id: "productOverview/name",
        code: null,
        before: { name: "Plant Pal" },
        after: { name: "Plant Pal Pro" },
      }]),
      ['Rewrote productOverview/name: "Plant Pal" → "Plant Pal Pro".'],
    );
  });

  it("lists added, removed, and rewritten items by code", () => {
    const lines = summarizeInputChanges([
      { id: "us-1", code: "US-1", before: { content: "old" }, after: { content: "new" } },
      { id: "us-2", code: "US-2", before: { content: "gone" }, after: null },
      { id: "us-3", code: "US-3", before: null, after: { content: "fresh" } },
    ]);
    assert.deepEqual(lines, [
      'Rewrote US-1: "old" → "new".',
      "Removed US-2.",
      'Added US-3: "fresh".',
    ]);
  });

  it("notes an item whose links changed under the same text", () => {
    assert.deepEqual(
      summarizeInputChanges([{
        id: "us-1",
        code: "US-1",
        before: { content: "same", references: [] },
        after: { content: "same", references: [{ id: "feat-1", type: "primary_feature" }] },
      }]),
      ["Changed the links of US-1."],
    );
  });

  it("names a formal artifact known only by revision", () => {
    assert.deepEqual(
      summarizeInputChanges([{
        id: "boundary",
        code: null,
        before: { revisionId: "r1" },
        after: { revisionId: "r2" },
      }]),
      ["Revised boundary."],
    );
  });

  it("caps long change lists", () => {
    const changes = Array.from({ length: 30 }, (_, index) => ({
      id: `us-${index}`,
      code: `US-${index}`,
      before: null,
      after: { content: `story ${index}` },
    }));
    const lines = summarizeInputChanges(changes);
    assert.equal(lines.length, 26);
    assert.equal(lines.at(-1), "…and 5 more changes.");
  });
});
