import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { describeToolOutput } from "../app/components/toolOutputSummary";

describe("tool output summaries", () => {
  it("passes human-readable confirmations through unchanged", () => {
    assert.equal(
      describeToolOutput("submit_product_overview_result", "Product overview applied"),
      "Product overview applied",
    );
  });

  it("passes error results through unchanged", () => {
    assert.equal(
      describeToolOutput("submit_user_stories_result", "Validation failed: story 2 is empty.", true),
      "Validation failed: story 2 is empty",
    );
  });

  it("summarizes a stage artifact read", () => {
    const payload = JSON.stringify({
      schemaVersion: 3,
      description: "A very simple calculator.",
      productOverview: { name: "TinyCalc", primaryFeatures: [] },
    });
    assert.equal(
      describeToolOutput("get_stage_artifacts", payload),
      "Read the product overview artifacts",
    );
  });

  it("lists multiple artifact sections", () => {
    const payload = JSON.stringify({
      schemaVersion: 3,
      userStories: [{ id: "us-1" }],
      requirements: [{ id: "r-1" }],
    });
    assert.equal(
      describeToolOutput("get_stage_artifacts", payload),
      "Read the user stories and requirements artifacts",
    );
  });

  it("summarizes workflow state and scaffold reads", () => {
    assert.equal(
      describeToolOutput("get_workflow_state", JSON.stringify({ stages: [] })),
      "Read the workflow state",
    );
    assert.equal(
      describeToolOutput("get_scaffold_files", JSON.stringify([
        { path: "src/App.tsx", content: "x" },
        { path: "src/index.ts", content: "y" },
      ])),
      "Read 2 scaffold files",
    );
    assert.equal(
      describeToolOutput("get_scaffold_files", JSON.stringify({ path: "src/App.tsx", content: "x" })),
      "Read the scaffold file src/App.tsx",
    );
  });

  it("falls back to a size note for unrecognized JSON", () => {
    const payload = JSON.stringify({ something: "else", nested: { a: 1 } });
    assert.match(
      describeToolOutput("unknown_tool", payload),
      /^Read structured data \(.*JSON\)$/,
    );
  });

  it("keeps non-JSON text (conversation outputs) verbatim", () => {
    assert.equal(
      describeToolOutput("communicate", "Question relayed to the user."),
      "Question relayed to the user",
    );
  });
});
