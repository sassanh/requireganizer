import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { summarizeStageInputChange } from "../app/store/stageInputDiff";

describe("stage input diff", () => {
  it("reports nothing for identical inputs", () => {
    const input = {
      productOverview: { name: "Plant Pal", purpose: "Keep plants alive." },
      userStories: [{ id: "story-1", content: "As a grower, I want rain." }],
    };
    assert.deepEqual(summarizeStageInputChange(input, structuredClone(input)), []);
  });

  it("names renamed overview fields", () => {
    const lines = summarizeStageInputChange(
      { productOverview: { name: "Plant Pal", purpose: "Keep plants alive." } },
      { productOverview: { name: "Plant Pal Pro", purpose: "Keep plants alive." } },
    );
    assert.deepEqual(lines, [
      'Product name changed from "Plant Pal" to "Plant Pal Pro".',
    ]);
  });

  it("lists added, removed, and rewritten items", () => {
    const lines = summarizeStageInputChange(
      {
        userStories: [
          { id: "story-1", content: "As a grower, I want rain." },
          { id: "story-2", content: "As a grower, I want sun." },
        ],
      },
      {
        userStories: [
          { id: "story-1", content: "As a grower, I want rain and shade." },
          { id: "story-3", content: "As a grower, I want soil." },
        ],
      },
    );
    assert.deepEqual(lines, [
      'User story removed: "As a grower, I want sun.".',
      'User story changed from "As a grower, I want rain." to "As a grower, I want rain and shade.".',
      'User story added: "As a grower, I want soil.".',
    ]);
  });

  it("notes revised items whose text is unchanged", () => {
    const lines = summarizeStageInputChange(
      { requirements: [{ id: "req-1", content: "Track watering.", references: [] }] },
      { requirements: [{ id: "req-1", content: "Track watering.", references: [{ id: "feat-1" }] }] },
    );
    assert.equal(lines.length, 1);
    assert.ok(lines[0].includes("Requirement revised (references changed)"));
    assert.ok(lines[0].includes("Track watering."));
  });

  it("names the changed design field", () => {
    const lines = summarizeStageInputChange(
      { boundaryDesign: { summary: "Single user.", risks: "None." } },
      { boundaryDesign: { summary: "Single user.", risks: "Data loss." } },
    );
    assert.deepEqual(lines, [
      'Boundary design changed (risks) from "None." to "Data loss.".',
    ]);
  });

  it("caps long change lists", () => {
    const before = Array.from({ length: 30 }, (_, index) => ({
      id: `story-${index}`,
      content: `Old story ${index}.`,
    }));
    const lines = summarizeStageInputChange({ userStories: [] }, { userStories: before });
    assert.equal(lines.length, 26);
    assert.equal(lines[25], "…and 5 more changes.");
  });
});
