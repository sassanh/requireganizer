import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifyListChange, listChangeCaption, regeneratedList } from "../app/store/listChange";

describe("list change classification", () => {
  it("treats revised rows as rewrites and pending-removal rows as drops", () => {
    const change = classifyListChange(
      [
        { id: "a", code: "US-1", revision: "a1" },
        { id: "b", code: "US-2", revision: "b1" },
        { id: "c", code: "US-3", revision: "c1" },
      ],
      [
        { id: "a", revision: "a2" },
        { id: "b", revision: "b1" },
        { id: "c", revision: "c1", pendingRemoval: true },
        { id: "d", revision: "d1" },
      ],
    );
    assert.deepEqual(change.changed, ["a"]);
    assert.deepEqual(change.kept, ["b"]);
    assert.deepEqual(change.added, ["d"]);
    assert.deepEqual(change.dropped, [{ id: "c", code: "US-3" }]);
  });
});

describe("regenerated list", () => {
  const previous = ["a", "b", "c", "d", "e"].map((id) => ({ id }));
  const regenerate = (proposed: string[]) =>
    regeneratedList(previous, proposed, new Set(proposed), ({ id }) => `${id} (dropped)`);

  it("puts every left-out item back at the position it held", () => {
    assert.deepEqual(regenerate(["a", "c", "e"]), ["a", "b (dropped)", "c", "d (dropped)", "e"]);
    assert.deepEqual(regenerate(["e"]), ["a (dropped)", "b (dropped)", "c (dropped)", "d (dropped)", "e"]);
    assert.deepEqual(regenerate([]), previous.map(({ id }) => `${id} (dropped)`));
  });

  it("keeps dropped positions whatever order and additions the proposal brings", () => {
    const list = regenerate(["new-1", "e", "c", "new-2", "new-3"]);
    previous.forEach(({ id }, index) => {
      if (id !== "c" && id !== "e") assert.equal(list[index], `${id} (dropped)`);
    });
    assert.deepEqual(list.filter((entry) => !entry.endsWith("(dropped)")), ["new-1", "e", "c", "new-2", "new-3"]);
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
