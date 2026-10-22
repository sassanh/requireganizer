import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  compareRevisionSnapshotsNewestFirst,
  snapshotIdsToPrune,
  sortRevisionSnapshotsNewestFirst,
} from "../app/lib/revisionStorage";

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

  it("prunes the older tied snapshot by id order", () => {
    const snapshots = [
      {
        id: "snapshot-a",
        createdAt: "2026-08-13T00:00:00.000Z",
        pinned: false,
      },
      {
        id: "snapshot-c",
        createdAt: "2026-08-13T00:00:00.000Z",
        pinned: false,
      },
      {
        id: "snapshot-b",
        createdAt: "2026-08-13T00:00:00.000Z",
        pinned: false,
      },
    ];

    assert.deepEqual(snapshotIdsToPrune(snapshots, 2), ["snapshot-a"]);
  });
});

describe("revision snapshot ordering", () => {
  it("orders by creation time newest first, then id descending", () => {
    const snapshots = [
      { id: "snapshot-a", createdAt: "2026-08-13T00:00:00.000Z" },
      { id: "snapshot-c", createdAt: "2026-08-13T00:00:01.000Z" },
      { id: "snapshot-b", createdAt: "2026-08-13T00:00:00.000Z" },
    ];

    assert.deepEqual(
      sortRevisionSnapshotsNewestFirst(snapshots).map(({ id }) => id),
      ["snapshot-c", "snapshot-b", "snapshot-a"],
    );
    assert.deepEqual(
      snapshots.map(({ id }) => id),
      ["snapshot-a", "snapshot-c", "snapshot-b"],
    );
  });

  it("compares snapshots with the same timestamp by id", () => {
    const older = { id: "snapshot-a", createdAt: "2026-08-13T00:00:00.000Z" };
    const newer = { id: "snapshot-b", createdAt: "2026-08-13T00:00:00.000Z" };

    assert.equal(compareRevisionSnapshotsNewestFirst(newer, older), -1);
    assert.equal(compareRevisionSnapshotsNewestFirst(older, newer), 1);
    assert.equal(compareRevisionSnapshotsNewestFirst(older, older), 0);
  });
});
