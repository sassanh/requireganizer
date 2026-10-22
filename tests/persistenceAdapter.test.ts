import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  describePersistenceAdapterContract,
  projectMeta,
  projectPayload,
  providerCall,
  timelineData,
} from "./support/persistenceAdapterContract";
import { ProjectStorageError } from "../app/lib/projectStorage";
import { ProviderCallStorageError } from "../app/lib/providerCallStorage";
import type { ProviderCallRecord } from "../app/lib/types";
import { MemoryPersistenceAdapter } from "../app/persistence";

interface FakeRevisionClock {
  now: () => Date;
  createRevisionSnapshotId: () => string;
  advance: (milliseconds: number) => void;
}

function fakeRevisionClock(
  start = "2026-10-22T09:00:00.000Z",
): FakeRevisionClock {
  let current = new Date(start).getTime();
  let sequence = 0;
  return {
    now: () => new Date(current),
    advance: (milliseconds) => {
      current += milliseconds;
    },
    createRevisionSnapshotId: () =>
      `snapshot-${String(sequence++).padStart(4, "0")}`,
  };
}

function createAdapterWithFakeClock(): {
  adapter: MemoryPersistenceAdapter;
  clock: FakeRevisionClock;
} {
  const clock = fakeRevisionClock();
  return {
    adapter: new MemoryPersistenceAdapter({
      now: clock.now,
      createRevisionSnapshotId: clock.createRevisionSnapshotId,
    }),
    clock,
  };
}

async function seedProject(adapter: MemoryPersistenceAdapter): Promise<void> {
  await adapter.projects.saveIndex([projectMeta("project-1")]);
  await adapter.projects.save("project-1", projectPayload("Example"));
  await adapter.timelines.save(
    "project-1",
    "module-a",
    timelineData("one"),
  );
  await adapter.revisions.save(
    "project-1",
    "module-a",
    { index: 1 },
    "Snapshot",
  );
  await adapter.providerCalls.replace("project-1", "module-a", [
    providerCall("call-a", "2026-10-22T09:00:00.000Z"),
  ]);
}

describePersistenceAdapterContract(() => new MemoryPersistenceAdapter());

describe("memory persistence adapter revision ordering and pruning", () => {
  it("orders equal timestamps newest first using the injected id", async () => {
    const { adapter } = createAdapterWithFakeClock();

    for (let index = 0; index < 5; index += 1) {
      await adapter.revisions.save(
        "project-1",
        "module-a",
        { index },
        `Snapshot ${index}`,
      );
    }

    assert.deepEqual(
      (await adapter.revisions.list("project-1", "module-a")).map(
        (snapshot) => snapshot.label,
      ),
      ["Snapshot 4", "Snapshot 3", "Snapshot 2", "Snapshot 1", "Snapshot 0"],
    );
  });

  it("breaks timestamp ties by id, not insertion order", async () => {
    const clock = fakeRevisionClock();
    const ids = [
      "snapshot-0002",
      "snapshot-0000",
      "snapshot-0003",
      "snapshot-0001",
    ];
    let nextId = 0;
    const adapter = new MemoryPersistenceAdapter({
      now: clock.now,
      createRevisionSnapshotId: () => ids[nextId++],
    });

    for (let index = 0; index < ids.length; index += 1) {
      await adapter.revisions.save(
        "project-1",
        "module-a",
        { index },
        `Snapshot ${index}`,
      );
    }

    assert.deepEqual(
      (await adapter.revisions.list("project-1", "module-a")).map(
        (snapshot) => snapshot.label,
      ),
      ["Snapshot 2", "Snapshot 0", "Snapshot 3", "Snapshot 1"],
    );
  });

  it("keeps exactly the newest 20 unpinned snapshots and leaves other modules alone", async () => {
    const { adapter, clock } = createAdapterWithFakeClock();
    const otherModuleIds: string[] = [];

    for (let index = 0; index < 3; index += 1) {
      const snapshot = await adapter.revisions.save(
        "project-1",
        "module-b",
        { index },
        `Other module ${index}`,
      );
      otherModuleIds.push(snapshot.id);
      clock.advance(1);
    }

    const savedIds: string[] = [];
    for (let index = 0; index < 22; index += 1) {
      const snapshot = await adapter.revisions.save(
        "project-1",
        "module-a",
        { index },
        `Snapshot ${index}`,
      );
      savedIds.push(snapshot.id);
      // Leave some saves on the same millisecond so ties are covered.
      clock.advance(index % 2 === 0 ? 1 : 0);
    }

    const listed = await adapter.revisions.list("project-1", "module-a");
    assert.deepEqual(
      listed.map((snapshot) => snapshot.id),
      savedIds.slice(-20).reverse(),
    );

    assert.deepEqual(
      (await adapter.revisions.list("project-1", "module-b")).map(
        (snapshot) => snapshot.id,
      ),
      [...otherModuleIds].reverse(),
    );
  });

  it("prunes each project separately even when module ids match", async () => {
    const { adapter, clock } = createAdapterWithFakeClock();
    const otherProjectIds: string[] = [];

    for (let index = 0; index < 3; index += 1) {
      const snapshot = await adapter.revisions.save(
        "project-2",
        "module-a",
        { index },
        `Other project ${index}`,
      );
      otherProjectIds.push(snapshot.id);
      clock.advance(1);
    }

    for (let index = 0; index < 22; index += 1) {
      await adapter.revisions.save(
        "project-1",
        "module-a",
        { index },
        `Snapshot ${index}`,
      );
      clock.advance(index % 2 === 0 ? 1 : 0);
    }

    assert.equal(
      (await adapter.revisions.list("project-1", "module-a")).length,
      20,
    );
    assert.deepEqual(
      (await adapter.revisions.list("project-2", "module-a")).map(
        (snapshot) => snapshot.id,
      ),
      [...otherProjectIds].reverse(),
    );
  });

  it("never prunes pinned snapshots", async () => {
    const { adapter, clock } = createAdapterWithFakeClock();
    const pinned = await adapter.revisions.save(
      "project-1",
      "module-a",
      { index: -1 },
      "Pinned",
      true,
    );
    clock.advance(1);

    const savedIds: string[] = [];
    for (let index = 0; index < 22; index += 1) {
      const snapshot = await adapter.revisions.save(
        "project-1",
        "module-a",
        { index },
        `Snapshot ${index}`,
      );
      savedIds.push(snapshot.id);
      clock.advance(index % 2 === 0 ? 1 : 0);
    }

    const listed = await adapter.revisions.list("project-1", "module-a");
    assert.deepEqual(
      listed.map((snapshot) => snapshot.id),
      [...savedIds.slice(-20).reverse(), pinned.id],
    );
  });
});

describe("memory persistence adapter failure injection", () => {
  it("reports a full storage for one timeline save instead of rejecting", async () => {
    const adapter = new MemoryPersistenceAdapter();
    adapter.failNext("timeline-save");

    assert.equal(
      await adapter.timelines.save(
        "project-1",
        "module-a",
        timelineData("first"),
      ),
      false,
    );
    assert.equal(
      await adapter.timelines.load("project-1", "module-a"),
      null,
    );

    assert.equal(
      await adapter.timelines.save(
        "project-1",
        "module-a",
        timelineData("first"),
      ),
      true,
    );
    assert.deepEqual(
      await adapter.timelines.load("project-1", "module-a"),
      timelineData("first"),
    );
  });

  it("rejects project writes with ProjectStorageError and keeps stored state", async () => {
    const adapter = new MemoryPersistenceAdapter();
    await adapter.projects.saveIndex([projectMeta("project-1")]);
    await adapter.projects.save("project-1", projectPayload("Example"));

    adapter.failNext("project-write");
    await assert.rejects(
      adapter.projects.saveIndex([projectMeta("project-2")]),
      ProjectStorageError,
    );
    assert.deepEqual(await adapter.projects.list(), [projectMeta("project-1")]);

    adapter.failNext("project-write");
    await assert.rejects(
      adapter.projects.save("project-1", projectPayload("Changed")),
      ProjectStorageError,
    );
    assert.deepEqual(
      await adapter.projects.load("project-1"),
      projectPayload("Example"),
    );

    adapter.failNext("project-write");
    await assert.rejects(
      adapter.projects.saveBundle(
        "project-2",
        projectPayload("Imported"),
        [projectMeta("project-1"), projectMeta("project-2")],
      ),
      ProjectStorageError,
    );
    assert.deepEqual(await adapter.projects.list(), [projectMeta("project-1")]);
    assert.equal(await adapter.projects.load("project-2"), null);

    adapter.failNext("project-write");
    await assert.rejects(
      adapter.projects.delete("project-1"),
      ProjectStorageError,
    );
    assert.deepEqual(
      await adapter.projects.load("project-1"),
      projectPayload("Example"),
    );
  });

  it("rejects provider-call reads with ProviderCallStorageError", async () => {
    const adapter = new MemoryPersistenceAdapter();
    await adapter.providerCalls.replace("project-1", "module-a", [
      providerCall("call-a", "2026-10-22T09:00:00.000Z"),
    ]);

    adapter.failNext("provider-call-read");
    await assert.rejects(
      adapter.providerCalls.load("project-1", "module-a"),
      ProviderCallStorageError,
    );
    assert.equal(
      (await adapter.providerCalls.load("project-1", "module-a")).length,
      1,
    );
  });

  it("rejects revision reads", async () => {
    const adapter = new MemoryPersistenceAdapter();
    await adapter.revisions.save(
      "project-1",
      "module-a",
      { index: 1 },
      "Snapshot",
    );

    adapter.failNext("revision-read");
    await assert.rejects(
      adapter.revisions.list("project-1", "module-a"),
      /Could not load revision snapshots/,
    );
    assert.equal(
      (await adapter.revisions.list("project-1", "module-a")).length,
      1,
    );
  });

  it("applies each queued failure to the next call of its kind", async () => {
    const adapter = new MemoryPersistenceAdapter();
    adapter.failNext("provider-call-read");
    adapter.failNext("revision-read");
    adapter.failNext("provider-call-read");

    await assert.rejects(
      adapter.providerCalls.load("project-1", "module-a"),
      ProviderCallStorageError,
    );
    await assert.rejects(
      adapter.revisions.list("project-1", "module-a"),
      /Could not load revision snapshots/,
    );
    await assert.rejects(
      adapter.providerCalls.load("project-1", "module-a"),
      ProviderCallStorageError,
    );

    assert.deepEqual(
      await adapter.providerCalls.load("project-1", "module-a"),
      [],
    );
    assert.deepEqual(
      await adapter.revisions.list("project-1", "module-a"),
      [],
    );
  });

  it("rejects provider-call writes without removing the previous rows", async () => {
    const adapter = new MemoryPersistenceAdapter();
    await adapter.providerCalls.replace("project-1", "module-a", [
      providerCall("call-a", "2026-10-22T09:00:00.000Z", "kept"),
    ]);

    adapter.failNext("provider-call-write");
    await assert.rejects(
      adapter.providerCalls.replace("project-1", "module-a", [
        providerCall("call-b", "2026-10-22T10:00:00.000Z"),
      ]),
      ProviderCallStorageError,
    );
    assert.deepEqual(
      (await adapter.providerCalls.load("project-1", "module-a")).map(
        (call) => call.id,
      ),
      ["call-a"],
    );
  });

  it("wraps unclonable provider calls and keeps the previous rows", async () => {
    const adapter = new MemoryPersistenceAdapter();
    await adapter.providerCalls.replace("project-1", "module-a", [
      providerCall("call-a", "2026-10-22T09:00:00.000Z", "kept"),
    ]);
    const unclonable = {
      ...providerCall("call-b", "2026-10-22T10:00:00.000Z"),
      callback: () => undefined,
    } as unknown as ProviderCallRecord;

    await assert.rejects(
      adapter.providerCalls.replace("project-1", "module-a", [unclonable]),
      ProviderCallStorageError,
    );
    assert.deepEqual(
      (await adapter.providerCalls.load("project-1", "module-a")).map(
        (call) => call.operation,
      ),
      ["kept"],
    );

    await assert.rejects(
      adapter.providerCalls.replace("project-1", "module-a", [
        providerCall("call-c", "2026-10-22T11:00:00.000Z"),
        unclonable,
      ]),
      ProviderCallStorageError,
    );
    assert.deepEqual(
      (await adapter.providerCalls.load("project-1", "module-a")).map(
        (call) => call.operation,
      ),
      ["kept"],
    );
  });

  it("rejects revision writes and leaves stored snapshots intact", async () => {
    const adapter = new MemoryPersistenceAdapter();
    const snapshot = await adapter.revisions.save(
      "project-1",
      "module-a",
      { index: 1 },
      "First",
    );

    adapter.failNext("revision-write");
    await assert.rejects(
      adapter.revisions.save("project-1", "module-a", { index: 2 }, "Second"),
      /revision snapshot/i,
    );
    assert.equal((await adapter.revisions.list("project-1", "module-a")).length, 1);

    adapter.failNext("revision-write");
    await assert.rejects(
      adapter.revisions.setPinned(snapshot.id, true),
      /revision snapshot/i,
    );
    assert.equal(
      (await adapter.revisions.list("project-1", "module-a"))[0].pinned,
      false,
    );

    adapter.failNext("revision-write");
    await assert.rejects(
      adapter.revisions.delete(snapshot.id),
      /revision snapshot/i,
    );
    assert.equal((await adapter.revisions.list("project-1", "module-a")).length, 1);
  });

  it("reports auxiliary stores that a project delete could not remove", async () => {
    const revisionsOnly = new MemoryPersistenceAdapter();
    await seedProject(revisionsOnly);
    revisionsOnly.failNext("revision-write");
    assert.deepEqual(await revisionsOnly.projects.delete("project-1"), {
      unremoved: ["revisions"],
    });
    assert.equal(await revisionsOnly.projects.load("project-1"), null);
    assert.equal(
      (await revisionsOnly.revisions.list("project-1", "module-a")).length,
      1,
    );
    assert.deepEqual(
      await revisionsOnly.providerCalls.load("project-1", "module-a"),
      [],
    );

    const providerCallsOnly = new MemoryPersistenceAdapter();
    await seedProject(providerCallsOnly);
    providerCallsOnly.failNext("provider-call-write");
    assert.deepEqual(await providerCallsOnly.projects.delete("project-1"), {
      unremoved: ["providerCalls"],
    });
    assert.equal(await providerCallsOnly.projects.load("project-1"), null);
    assert.deepEqual(
      await providerCallsOnly.revisions.list("project-1", "module-a"),
      [],
    );
    assert.equal(
      (await providerCallsOnly.providerCalls.load("project-1", "module-a"))
        .length,
      1,
    );

    const both = new MemoryPersistenceAdapter();
    await seedProject(both);
    both.failNext("revision-write");
    both.failNext("provider-call-write");
    assert.deepEqual(await both.projects.delete("project-1"), {
      unremoved: ["revisions", "providerCalls"],
    });
    assert.equal(await both.projects.load("project-1"), null);
  });
});
