import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { snapshotIdsToPrune } from "../app/lib/revisionStorage";

describe("revision snapshot retention", () => {
  it("keeps the newest unpinned snapshots and never prunes pinned snapshots", () => {
    const snapshots = Array.from({ length: 23 }, (_, index) => ({
      id: `snapshot-${index}`,
      createdAt: `2026-08-13T00:${String(index).padStart(2, "0")}:00.000Z`,
      pinned: false,
    }));
    snapshots[0].pinned = true;

    assert.deepEqual(
      new Set(snapshotIdsToPrune(snapshots, 20)),
      new Set(["snapshot-1", "snapshot-2"]),
    );
  });
});
