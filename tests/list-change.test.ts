import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifyListChange, listChangeCaption } from "../app/store/listChange";

describe("list change classification", () => {
  it("treats last-signed rows as rewrites and pending-removal rows as drops", () => {
    const change = classifyListChange(
      [
        { id: "a", code: "US-1" },
        { id: "b", code: "US-2" },
        { id: "c", code: "US-3" },
      ],
      [
        { id: "a", lastSignedContent: "old a" },
        { id: "b", lastSignedContent: null },
        { id: "c", lastSignedContent: null, pendingRemoval: true },
        { id: "d", lastSignedContent: null },
      ],
    );
    assert.deepEqual(change.changed, ["a"]);
    assert.deepEqual(change.kept, ["b"]);
    assert.deepEqual(change.added, ["d"]);
    assert.deepEqual(change.dropped, [{ id: "c", code: "US-3" }]);
  });
});

describe("list change caption grain", () => {
  it("uses item grain for a single rewrite", () => {
    const caption = listChangeCaption({
      kept: ["b"],
      changed: ["a"],
      added: [],
      dropped: [],
    });
    assert.equal(caption.grain, "item");
    assert.equal(caption.itemId, "a");
    assert.equal(caption.text, null);
  });

  it("uses a stage line when anything was dropped or more than one rewrite", () => {
    const caption = listChangeCaption({
      kept: ["b"],
      changed: ["a"],
      added: ["d"],
      dropped: [{ id: "c", code: "US-3" }],
    });
    assert.equal(caption.grain, "stage");
    assert.equal(caption.itemId, null);
    assert.equal(caption.text, "Kept 1 · Rewrote 1 · Added 1 · Dropped US-3");
  });

  it("uses item grain for a single pending removal", () => {
    const caption = listChangeCaption({
      kept: ["b"],
      changed: [],
      added: [],
      dropped: [{ id: "c", code: "US-3" }],
    });
    assert.equal(caption.grain, "item");
    assert.equal(caption.itemId, "c");
    assert.equal(caption.text, null);
  });

  it("has no caption for a first generate of only new items", () => {
    const caption = listChangeCaption({
      kept: [],
      changed: [],
      added: ["a", "b"],
      dropped: [],
    });
    assert.equal(caption.text, null);
  });
});
