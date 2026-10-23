import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MODULE_SCHEMA_VERSION } from "../../app/lib/projectSchema";
import {
  ProjectStorageError,
  type ProjectMeta,
} from "../../app/lib/projectStorage";
import { ProviderCallStorageError } from "../../app/lib/providerCallStorage";
import type { ProviderCallRecord } from "../../app/lib/types";
import type { PersistenceAdapter } from "../../app/persistence";
import { TIMELINE_VERSION } from "../../app/store/timeline/serialize";

type AdapterFactory = () => PersistenceAdapter | Promise<PersistenceAdapter>;

export function projectMeta(id: string, name = id): ProjectMeta {
  return {
    id,
    name,
    description: `${name} description`,
    updatedAt: "2026-10-22T09:00:00.000Z",
  };
}

export function projectPayload(name: string): Record<string, unknown> {
  return {
    schemaVersion: MODULE_SCHEMA_VERSION,
    productOverview: { name, purpose: `${name} purpose` },
    scaffoldFiles: [{ path: "src/index.ts", content: "export {};" }],
  };
}

export function timelineData(marker: string): Record<string, unknown> {
  return { version: TIMELINE_VERSION, marker };
}

export function providerCall(
  id: string,
  startedAt: string,
  marker = id,
): ProviderCallRecord {
  return {
    id,
    operation: marker,
    attempt: 1,
    promptVersion: "2026-10-22.1",
    protocolVersion: 6,
    startedAt,
    durationMs: 100,
    provider: "provider",
    model: "model",
    outcome: "success",
    toolCallCount: 0,
    usage: { inputTokens: 10, outputTokens: 5 },
  };
}

function circularRecord(): Record<string, unknown> {
  const record: Record<string, unknown> = { label: "circular" };
  record.self = record;
  return record;
}

/**
 * The adapter contract, written only against `PersistenceAdapter` so the
 * same tests can run against the web, file, or Durable Object adapters.
 */
export function describePersistenceAdapterContract(
  createAdapter: AdapterFactory,
): void {
  describe("persistence adapter contract", () => {
    it("reports empty reads when nothing is stored", async () => {
      const adapter = await createAdapter();

      assert.deepEqual(await adapter.projects.list(), []);
      assert.equal(await adapter.projects.load("project-1"), null);
      assert.equal(
        await adapter.timelines.load("project-1", "module-a"),
        null,
      );
      assert.deepEqual(
        await adapter.revisions.list("project-1", "module-a"),
        [],
      );
      assert.deepEqual(
        await adapter.providerCalls.load("project-1", "module-a"),
        [],
      );
    });

    it("round-trips and overwrites the projects index", async () => {
      const adapter = await createAdapter();
      const expected = [projectMeta("project-1"), projectMeta("project-2")];
      const projects = [
        projectMeta("project-1"),
        projectMeta("project-2"),
      ];

      await adapter.projects.saveIndex(projects);
      assert.deepEqual(await adapter.projects.list(), expected);

      await adapter.projects.saveIndex([projectMeta("project-3", "Replacement")]);
      assert.deepEqual(await adapter.projects.list(), [
        projectMeta("project-3", "Replacement"),
      ]);
    });

    it("isolates the projects index from caller mutations", async () => {
      const adapter = await createAdapter();
      const expected = [projectMeta("project-1"), projectMeta("project-2")];
      const projects = [
        projectMeta("project-1"),
        projectMeta("project-2"),
      ];

      await adapter.projects.saveIndex(projects);
      projects[0].name = "Mutated after save";
      projects.push(projectMeta("project-3"));
      assert.deepEqual(await adapter.projects.list(), expected);

      const loaded = await adapter.projects.list();
      loaded[0].name = "Mutated after read";
      assert.deepEqual(await adapter.projects.list(), expected);
    });

    it("filters malformed and duplicate index entries", async () => {
      const adapter = await createAdapter();
      const invalid = {
        id: "",
        name: "",
        description: 1,
        updatedAt: "not a date",
      } as unknown as ProjectMeta;

      await adapter.projects.saveIndex([
        projectMeta("project-1", "First"),
        projectMeta("project-1", "Duplicate"),
        invalid,
      ]);

      assert.deepEqual(await adapter.projects.list(), [
        projectMeta("project-1", "First"),
      ]);
    });

    it("round-trips, overwrites, and copies project payloads", async () => {
      const adapter = await createAdapter();
      const payload = {
        schemaVersion: MODULE_SCHEMA_VERSION,
        productOverview: { name: "Example" },
        nested: { values: [1] },
      };
      const expected = structuredClone(payload);

      await adapter.projects.save("project-1", payload);
      assert.deepEqual(await adapter.projects.load("project-1"), expected);

      payload.nested.values[0] = 99;
      assert.deepEqual(await adapter.projects.load("project-1"), expected);

      const loaded = (await adapter.projects.load("project-1")) as typeof payload;
      loaded.nested.values[0] = 42;
      assert.deepEqual(await adapter.projects.load("project-1"), expected);

      await adapter.projects.save("project-1", { replacement: true });
      assert.deepEqual(await adapter.projects.load("project-1"), {
        replacement: true,
      });
    });

    it("refreshes only one index entry with a project save, keeping its name", async () => {
      const adapter = await createAdapter();
      const first = projectMeta("project-1", "First");
      const second = projectMeta("project-2", "Second");
      await adapter.projects.saveIndex([first, second]);

      const update = {
        description: "Updated purpose",
        updatedAt: "2026-10-23T10:00:00.000Z",
      };
      await adapter.projects.save(
        "project-1",
        projectPayload("First updated"),
        update,
      );

      // The adapter reads the current index itself, so a caller that never
      // saw project-2 cannot drop it.
      assert.deepEqual(await adapter.projects.list(), [
        { ...first, ...update },
        second,
      ]);
    });

    it("leaves the index untouched when a project payload write fails", async () => {
      const adapter = await createAdapter();
      const projects = [
        projectMeta("project-1", "First"),
        projectMeta("project-2", "Second"),
      ];
      await adapter.projects.saveIndex(projects);

      await assert.rejects(
        adapter.projects.save(
          "project-1",
          circularRecord(),
          {
            description: "Failed update",
            updatedAt: "2026-10-23T10:00:00.000Z",
          },
        ),
        ProjectStorageError,
      );

      assert.deepEqual(await adapter.projects.list(), projects);
    });

    it("observes a write from a read issued immediately after it", async () => {
      const adapter = await createAdapter();
      const payload = projectPayload("Read after write");
      const before = projectMeta("project-1", "Before");
      await adapter.projects.saveIndex([before]);
      const update = {
        description: "Read after write",
        updatedAt: "2026-10-23T10:00:00.000Z",
      };

      const projectWrite = adapter.projects.save("project-1", payload, update);
      const projectRead = adapter.projects.load("project-1");
      const indexRead = adapter.projects.list();
      assert.deepEqual(await projectRead, payload);
      assert.deepEqual(await indexRead, [{ ...before, ...update }]);
      await projectWrite;

      const timeline = timelineData("read after write");
      const timelineWrite = adapter.timelines.save(
        "project-1",
        "module-a",
        timeline,
      );
      assert.deepEqual(
        await adapter.timelines.load("project-1", "module-a"),
        timeline,
      );
      assert.equal(await timelineWrite, true);
    });

    it("loads non-object project payloads as null", async () => {
      const adapter = await createAdapter();

      await adapter.projects.save("project-1", ["not", "an", "object"]);
      assert.equal(await adapter.projects.load("project-1"), null);

      await adapter.projects.save("project-1", "not an object either");
      assert.equal(await adapter.projects.load("project-1"), null);
    });

    it("saves a project payload and its index together as a bundle", async () => {
      const adapter = await createAdapter();
      const projects = [projectMeta("project-1", "Bundled")];
      const payload = projectPayload("Bundled");

      await adapter.projects.saveBundle("project-1", payload, projects);
      assert.deepEqual(await adapter.projects.load("project-1"), payload);
      assert.deepEqual(await adapter.projects.list(), projects);

      const updatedProjects = [
        projectMeta("project-1", "Bundled"),
        projectMeta("project-2", "Imported"),
      ];
      await adapter.projects.saveBundle(
        "project-2",
        projectPayload("Imported"),
        updatedProjects,
      );
      assert.deepEqual(await adapter.projects.list(), updatedProjects);
      assert.deepEqual(await adapter.projects.load("project-1"), payload);
    });

    it("rejects unserializable project writes and leaves state unchanged", async () => {
      const adapter = await createAdapter();
      const projects = [projectMeta("project-1", "Kept")];
      const payload = projectPayload("Kept");
      await adapter.projects.saveIndex(projects);
      await adapter.projects.save("project-1", payload);

      await assert.rejects(
        adapter.projects.save("project-1", circularRecord()),
        ProjectStorageError,
      );
      assert.deepEqual(await adapter.projects.load("project-1"), payload);

      await assert.rejects(
        adapter.projects.saveIndex([
          projectMeta("project-2"),
          circularRecord() as unknown as ProjectMeta,
        ]),
        ProjectStorageError,
      );
      assert.deepEqual(await adapter.projects.list(), projects);

      await assert.rejects(
        adapter.projects.saveBundle(
          "project-2",
          circularRecord(),
          [...projects, projectMeta("project-2")],
        ),
        ProjectStorageError,
      );
      assert.deepEqual(await adapter.projects.list(), projects);
      assert.equal(await adapter.projects.load("project-2"), null);

      await assert.rejects(
        adapter.projects.saveBundle(
          "project-2",
          projectPayload("Imported"),
          [
            ...projects,
            circularRecord() as unknown as ProjectMeta,
          ],
        ),
        ProjectStorageError,
      );
      assert.deepEqual(await adapter.projects.list(), projects);
      assert.equal(await adapter.projects.load("project-2"), null);
    });

    it("round-trips timelines per module and copies their data", async () => {
      const adapter = await createAdapter();
      const first = timelineData("first");

      assert.equal(
        await adapter.timelines.save("project-1", "module-a", first),
        true,
      );
      assert.deepEqual(
        await adapter.timelines.load("project-1", "module-a"),
        first,
      );
      assert.equal(
        await adapter.timelines.load("project-1", "module-b"),
        null,
      );

      first.marker = "mutated after save";
      assert.deepEqual(
        await adapter.timelines.load("project-1", "module-a"),
        timelineData("first"),
      );

      const loaded = (await adapter.timelines.load(
        "project-1",
        "module-a",
      )) as Record<string, unknown>;
      loaded.marker = "mutated after read";
      assert.deepEqual(
        await adapter.timelines.load("project-1", "module-a"),
        timelineData("first"),
      );

      await adapter.timelines.save(
        "project-1",
        "module-a",
        timelineData("second"),
      );
      assert.deepEqual(
        await adapter.timelines.load("project-1", "module-a"),
        timelineData("second"),
      );

      await adapter.timelines.save("project-1", "module-a", {
        version: TIMELINE_VERSION + 1,
        marker: "obsolete",
      });
      assert.equal(
        await adapter.timelines.load("project-1", "module-a"),
        null,
      );
    });

    it("resolves false for unserializable timelines and leaves state unchanged", async () => {
      const adapter = await createAdapter();
      await adapter.timelines.save(
        "project-1",
        "module-a",
        timelineData("kept"),
      );

      assert.equal(
        await adapter.timelines.save(
          "project-1",
          "module-a",
          circularRecord(),
        ),
        false,
      );
      assert.deepEqual(
        await adapter.timelines.load("project-1", "module-a"),
        timelineData("kept"),
      );
    });

    it("stores and copies revision snapshots", async () => {
      const adapter = await createAdapter();
      const data = { values: [{ name: "Example" }] };
      const snapshot = await adapter.revisions.save(
        "project-1",
        "module-a",
        data,
        "Before restoring Example",
      );

      assert.equal(snapshot.projectId, "project-1");
      assert.equal(snapshot.scopeId, "project-1::module-a");
      assert.equal(snapshot.label, "Before restoring Example");
      assert.equal(snapshot.pinned, false);

      const listed = await adapter.revisions.list("project-1", "module-a");
      assert.equal(listed.length, 1);
      assert.deepEqual(listed[0].data, data);
      assert.deepEqual(await adapter.revisions.list("project-1", "module-b"), []);

      data.values[0].name = "Mutated after save";
      const storedAfterSave = (await adapter.revisions.list(
        "project-1",
        "module-a",
      ))[0].data as typeof data;
      assert.equal(storedAfterSave.values[0].name, "Example");

      storedAfterSave.values[0].name = "Mutated after read";
      const storedAfterRead = (await adapter.revisions.list(
        "project-1",
        "module-a",
      ))[0].data as typeof data;
      assert.equal(storedAfterRead.values[0].name, "Example");
    });

    it("pins, unpins, and deletes revision snapshots", async () => {
      const adapter = await createAdapter();
      const first = await adapter.revisions.save(
        "project-1",
        "module-a",
        { index: 1 },
        "First",
      );
      await adapter.revisions.save(
        "project-1",
        "module-a",
        { index: 2 },
        "Second",
      );

      await adapter.revisions.setPinned(first.id, true);
      assert.equal(
        (await adapter.revisions.list("project-1", "module-a")).find(
          (snapshot) => snapshot.id === first.id,
        )?.pinned,
        true,
      );

      await adapter.revisions.setPinned(first.id, false);
      assert.equal(
        (await adapter.revisions.list("project-1", "module-a")).find(
          (snapshot) => snapshot.id === first.id,
        )?.pinned,
        false,
      );

      await adapter.revisions.delete(first.id);
      assert.deepEqual(
        (await adapter.revisions.list("project-1", "module-a")).map(
          (snapshot) => snapshot.label,
        ),
        ["Second"],
      );

      await adapter.revisions.delete("missing-snapshot");
      assert.deepEqual(
        (await adapter.revisions.list("project-1", "module-a")).map(
          (snapshot) => snapshot.label,
        ),
        ["Second"],
      );
    });

    it("rejects pinning a snapshot that no longer exists", async () => {
      const adapter = await createAdapter();

      await assert.rejects(
        adapter.revisions.setPinned("missing", true),
        /no longer exists/,
      );
    });

    it("replaces provider calls with the last duplicate, ordered on read", async () => {
      const adapter = await createAdapter();

      await adapter.providerCalls.replace("project-1", "module-a", [
        providerCall("call-c", "2026-10-22T09:00:00.000Z", "c"),
        providerCall("call-a", "2026-10-22T10:00:00.000Z", "earlier duplicate"),
        providerCall("call-b", "2026-10-22T09:00:00.000Z", "b"),
        providerCall("call-a", "2026-10-22T08:00:00.000Z", "last duplicate"),
      ]);

      const calls = await adapter.providerCalls.load("project-1", "module-a");
      assert.deepEqual(
        calls.map((call) => call.id),
        ["call-a", "call-b", "call-c"],
      );
      assert.deepEqual(
        calls.map((call) => call.operation),
        ["last duplicate", "b", "c"],
      );
    });

    it("takes over a provider-call id from another module of the project", async () => {
      const adapter = await createAdapter();
      await adapter.providerCalls.replace("project-1", "module-a", [
        providerCall("call-a", "2026-10-22T09:00:00.000Z", "in module a"),
      ]);
      await adapter.providerCalls.replace("project-1", "module-b", [
        providerCall("call-a", "2026-10-22T10:00:00.000Z", "in module b"),
      ]);

      assert.deepEqual(
        await adapter.providerCalls.load("project-1", "module-a"),
        [],
      );
      assert.deepEqual(
        (await adapter.providerCalls.load("project-1", "module-b")).map(
          (call) => call.operation,
        ),
        ["in module b"],
      );
    });

    it("orders equal provider-call start times by UTF-16 code unit", async () => {
      const adapter = await createAdapter();
      const ids = ["B", "Z", "_x", "a", "c-1", "c1"];
      await adapter.providerCalls.replace(
        "project-1",
        "module-a",
        [...ids].reverse().map((id) =>
          providerCall(id, "2026-10-22T09:00:00.000Z"),
        ),
      );

      assert.deepEqual(
        (await adapter.providerCalls.load("project-1", "module-a")).map(
          (call) => call.id,
        ),
        ids,
      );
    });

    it("isolates provider calls from caller mutations", async () => {
      const adapter = await createAdapter();
      const calls = [
        providerCall("call-a", "2026-10-22T09:00:00.000Z"),
      ];

      await adapter.providerCalls.replace("project-1", "module-a", calls);
      calls[0].operation = "mutated after save";
      calls[0].usage!.inputTokens = 99;

      const loaded = await adapter.providerCalls.load("project-1", "module-a");
      assert.equal(loaded[0].operation, "call-a");
      assert.equal(loaded[0].usage?.inputTokens, 10);

      loaded[0].operation = "mutated after read";
      loaded[0].usage!.inputTokens = 42;
      const reloaded = await adapter.providerCalls.load(
        "project-1",
        "module-a",
      );
      assert.equal(reloaded[0].operation, "call-a");
      assert.equal(reloaded[0].usage?.inputTokens, 10);
    });

    it("deletes everything stored for a project", async () => {
      const adapter = await createAdapter();
      await adapter.projects.saveIndex([
        projectMeta("project-1"),
        projectMeta("project-2"),
      ]);
      await adapter.projects.save("project-1", projectPayload("Deleted"));
      await adapter.projects.save("project-2", projectPayload("Kept"));
      await adapter.timelines.save(
        "project-1",
        "module-a",
        timelineData("one"),
      );
      await adapter.timelines.save(
        "project-1",
        "module-b",
        timelineData("two"),
      );
      await adapter.timelines.save(
        "project-2",
        "module-a",
        timelineData("kept"),
      );
      const deletedRevision = await adapter.revisions.save(
        "project-1",
        "module-a",
        { index: 1 },
        "Deleted",
      );
      await adapter.revisions.save(
        "project-1",
        "module-b",
        { index: 2 },
        "Deleted too",
      );
      const keptRevision = await adapter.revisions.save(
        "project-2",
        "module-a",
        { index: 3 },
        "Kept",
      );
      await adapter.providerCalls.replace("project-1", "module-a", [
        providerCall("call-a", "2026-10-22T09:00:00.000Z"),
      ]);
      await adapter.providerCalls.replace("project-2", "module-a", [
        providerCall("call-b", "2026-10-22T10:00:00.000Z"),
      ]);

      const result = await adapter.projects.delete("project-1");
      assert.deepEqual(result, { unremoved: [] });

      assert.equal(await adapter.projects.load("project-1"), null);
      assert.equal(
        await adapter.timelines.load("project-1", "module-a"),
        null,
      );
      assert.equal(
        await adapter.timelines.load("project-1", "module-b"),
        null,
      );
      assert.deepEqual(
        (await adapter.projects.list()).map((project) => project.id),
        ["project-2"],
      );
      assert.deepEqual(
        await adapter.revisions.list("project-1", "module-a"),
        [],
      );
      assert.deepEqual(
        await adapter.revisions.list("project-1", "module-b"),
        [],
      );
      assert.deepEqual(
        await adapter.providerCalls.load("project-1", "module-a"),
        [],
      );
      assert.equal(
        (await adapter.revisions.list("project-2", "module-a"))[0].id,
        keptRevision.id,
      );
      assert.equal(
        (await adapter.revisions.list("project-2", "module-a")).some(
          (snapshot) => snapshot.id === deletedRevision.id,
        ),
        false,
      );

      assert.deepEqual(await adapter.projects.load("project-2"), projectPayload("Kept"));
      assert.deepEqual(
        await adapter.timelines.load("project-2", "module-a"),
        timelineData("kept"),
      );
      assert.equal(
        (await adapter.providerCalls.load("project-2", "module-a")).length,
        1,
      );
    });

    it("keeps the timelines of a project whose id extends the deleted one", async () => {
      const adapter = await createAdapter();
      await adapter.projects.saveIndex([
        projectMeta("a"),
        projectMeta("a::b"),
      ]);
      await adapter.projects.save("a", projectPayload("A"));
      await adapter.projects.save("a::b", projectPayload("A B"));
      const kept = timelineData("kept");
      assert.equal(await adapter.timelines.save("a::b", "module-c", kept), true);
      assert.equal(
        await adapter.timelines.save("a", "module-c", timelineData("removed")),
        true,
      );

      await adapter.projects.delete("a");

      assert.equal(await adapter.timelines.load("a", "module-c"), null);
      assert.deepEqual(await adapter.timelines.load("a::b", "module-c"), kept);
    });

    it("deletes a missing project without error", async () => {
      const adapter = await createAdapter();

      assert.deepEqual(await adapter.projects.delete("missing"), {
        unremoved: [],
      });
      assert.deepEqual(await adapter.projects.list(), []);
    });
  });
}
