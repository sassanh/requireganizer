import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ArtifactProposalItem } from "../app/ai-harness/contracts";
import { materializeArtifactItems } from "../app/ai-harness/reconciliation";
import { Priority, StructuralFragment } from "../app/store/constants";

function item(
  key: string,
  dependencies: string[],
  id?: string,
): ArtifactProposalItem {
  return {
    key,
    id,
    content: `Content for ${key}`,
    priority: Priority.P0,
    references: [
      { id: "story-1", type: StructuralFragment.UserStory },
    ],
    dependencies,
  };
}

describe("artifact reconciliation", () => {
  it("preserves existing IDs and resolves local dependency keys", () => {
    let generated = 0;
    const result = materializeArtifactItems(
      [
        item("preserved", [], "existing-id"),
        item("new-item", ["preserved"]),
      ],
      () => `generated-${++generated}`,
    );

    assert.equal(result[0].id, "existing-id");
    assert.equal(result[1].id, "generated-1");
    assert.deepEqual(result[1].dependencies, ["existing-id"]);
    assert.equal(generated, 1);
  });

  it("rejects duplicate or unknown local keys defensively", () => {
    assert.throws(
      () => materializeArtifactItems([item("same", []), item("same", [])], () => "id"),
      /duplicate proposal key/,
    );
    assert.throws(
      () => materializeArtifactItems([item("one", ["missing"])], () => "id"),
      /Cannot resolve dependency key missing/,
    );
  });
});
