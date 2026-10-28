import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getSnapshot } from "mobx-state-tree";

import {
  ControllablePersistenceAdapter,
  type TimelineWriteRecord,
} from "./support/controllablePersistence";
import { installFakeWebEnvironment } from "./support/fakeWebEnvironment";
import { ManualProjectWriteAdapter } from "./support/manualProjectWrite";
import { UserFacingError } from "../app/lib/errors";
import {
  LEGACY_MODULE_ID,
  type ModuleEntry,
  type ModuleRegistry,
  type ProjectPayload,
  visibleModules,
} from "../app/lib/moduleSchema";
import { PROJECT_SCHEMA_VERSION } from "../app/lib/projectSchema";
import type { ProjectMeta } from "../app/lib/projectStorage";
import { HARNESS_PROTOCOL_VERSION, PROMPT_VERSION } from "../app/lib/types";
import { MemoryPersistenceAdapter, WebPersistenceAdapter } from "../app/persistence";
import {
  PROJECT_SAVE_DEBOUNCE_MS,
  ProjectSession,
  type ProjectSessionStatus,
} from "../app/project-session";
import { WorkflowStage } from "../app/store/constants";
import { Store } from "../app/store/store";
import {
  attachTimeline,
  commitTimelineSegment,
  getTimelineSnapshot,
} from "../app/store/timeline/controller";

/** A module snapshot marked by `label`: its one primary feature, which the tests' edits leave alone. */
function snapshotWith(label: string, purpose = ""): Record<string, unknown> {
  const store = Store.create({ productOverview: { primaryFeatures: [{ content: label }] } });
  if (purpose.length > 0) store.setPurpose({ purpose });
  return getSnapshot(store) as unknown as Record<string, unknown>;
}

/** Which module a stored snapshot holds: the label `snapshotWith` gave it. */
function storedLabelOf(snapshot: Record<string, unknown> | undefined): string | undefined {
  const overview = snapshot?.productOverview as { primaryFeatures?: { content: string }[] } | undefined;
  return overview?.primaryFeatures?.[0]?.content;
}

/** Which module a store shows: the label `snapshotWith` gave it. */
function labelOf(store: Store): string | undefined {
  return store.productOverview.primaryFeatures[0]?.content;
}

function moduleEntry(
  id: string,
  name: string,
  snapshot: Record<string, unknown> = snapshotWith(name),
): ModuleEntry {
  return {
    id,
    name,
    archivedAt: null,
    openStep: WorkflowStage.ProductOverview,
    snapshot,
  };
}

function projectRegistry(
  modules: ModuleEntry[],
  activeModuleId: string,
  modulesEnabled = true,
): ModuleRegistry {
  return { modulesEnabled, activeModuleId, modules };
}

function projectPayload(registry: ModuleRegistry): ProjectPayload {
  return { schemaVersion: PROJECT_SCHEMA_VERSION, ...registry };
}

function projectMeta(id: string, name: string): ProjectMeta {
  return {
    id,
    name,
    description: "",
    updatedAt: "2026-08-11T00:00:00.000Z",
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(
  description: string,
  condition: () => boolean,
): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${description}.`);
    }
    await delay(0);
  }
  await delay(0);
}

async function waitForStatus(
  session: ProjectSession,
  status: ProjectSessionStatus,
): Promise<void> {
  await waitFor(
    `status ${status}`,
    () => session.getSnapshot().status === status,
  );
}

async function waitForModuleTimeline(
  adapter: ControllablePersistenceAdapter,
  projectId: string,
  moduleId: string,
  minimumLoads = 1,
): Promise<void> {
  await waitFor(
    `timeline load for ${projectId}::${moduleId}`,
    () =>
      adapter.timelineLoads.filter(
        (load) =>
          load.projectId === projectId &&
          load.moduleId === moduleId &&
          load.completed,
      ).length >= minimumLoads,
  );
}

function activeSnapshotOf(payload: unknown): Record<string, unknown> {
  const project = payload as ProjectPayload;
  const active = project.modules.find(
    (entry) => entry.id === project.activeModuleId,
  );
  assert.ok(active != null);
  return active.snapshot;
}

function overviewOf(payload: unknown): Record<string, unknown> {
  return (activeSnapshotOf(payload).productOverview ?? {}) as Record<
    string,
    unknown
  >;
}

async function storedProject(
  adapter: ControllablePersistenceAdapter,
  id: string,
): Promise<ProjectPayload> {
  const data = await adapter.projects.load(id);
  assert.ok(data != null);
  return data as unknown as ProjectPayload;
}

async function storedTimeline(
  adapter: ControllablePersistenceAdapter,
  projectId: string,
  moduleId: string,
): Promise<Record<string, unknown> | null> {
  return adapter.timelines.load(projectId, moduleId);
}

async function rawTimeline(
  adapter: ControllablePersistenceAdapter,
  projectId: string,
  moduleId: string,
): Promise<Record<string, unknown> | null> {
  return adapter.inner.timelines.load(projectId, moduleId);
}

function timelineContains(
  timeline: Record<string, unknown> | null,
  text: string,
): boolean {
  if (timeline == null) return false;
  return JSON.stringify(timeline).includes(text);
}

function timelineWritesFor(
  adapter: ControllablePersistenceAdapter,
  projectId: string,
  moduleId: string,
): TimelineWriteRecord[] {
  return adapter.timelineWrites.filter(
    (write) =>
      write.projectId === projectId && write.moduleId === moduleId,
  );
}

async function seedProject(
  adapter: ControllablePersistenceAdapter,
  id: string,
  payload: ProjectPayload,
  name = "Project",
): Promise<void> {
  await adapter.inner.projects.saveIndex([projectMeta(id, name)]);
  await adapter.inner.projects.save(id, payload);
}

async function seedTimeline(
  adapter: ControllablePersistenceAdapter,
  projectId: string,
  moduleId: string,
  purpose: string,
): Promise<Record<string, unknown>> {
  const store = Store.create({
    productOverview: { purpose },
  });
  attachTimeline(store);
  store.setPurpose({ purpose });
  commitTimelineSegment();
  const timeline = getTimelineSnapshot();
  assert.ok(timeline != null);
  await adapter.inner.timelines.save(projectId, moduleId, timeline);
  return timeline;
}

function importedProject(): ProjectPayload {
  return projectPayload(
    projectRegistry(
      [
        moduleEntry(
          "module-imported",
          "Imported",
          snapshotWith("Imported"),
        ),
      ],
      "module-imported",
      false,
    ),
  );
}

describe("project session loading", () => {
  it("opens the active module of a valid stored project", async () => {
    const adapter = new ControllablePersistenceAdapter();
    await seedProject(
      adapter,
      "project-1",
      projectPayload(
        projectRegistry(
          [
            moduleEntry("module-a", "Payments", snapshotWith("Payments")),
            moduleEntry("module-b", "Billing", snapshotWith("Billing")),
          ],
          "module-b",
        ),
      ),
    );

    const session = new ProjectSession(adapter);
    await session.selectProject("project-1", "Project");

    const state = session.getSnapshot();
    assert.equal(state.status, "ready");
    assert.deepEqual(state.activeProject, { id: "project-1", name: "Project" });
    assert.equal(state.registry?.activeModuleId, "module-b");
    assert.equal(labelOf(state.store), "Billing");
    assert.equal(state.persistenceError, null);
  });

  it("reports loading while the project and timeline load", async () => {
    const adapter = new ControllablePersistenceAdapter();
    await seedProject(
      adapter,
      "project-1",
      projectPayload(
        projectRegistry([moduleEntry("module-a", "Alpha")], "module-a"),
      ),
    );
    adapter.hold("project-load:project-1");

    const session = new ProjectSession(adapter);
    const opened = session.selectProject("project-1", "Project");

    assert.equal(session.getSnapshot().status, "loading");
    assert.deepEqual(session.getSnapshot().activeProject, {
      id: "project-1",
      name: "Project",
    });
    assert.equal(session.getSnapshot().registry, null);

    adapter.release("project-load:project-1");
    await opened;
    assert.equal(session.getSnapshot().status, "ready");
  });

  it("fails to open invalid stored data and leaves it unchanged", async () => {
    const adapter = new ControllablePersistenceAdapter();
    await adapter.inner.projects.save("project-1", { schemaVersion: 999 });

    const session = new ProjectSession(adapter);
    await session.selectProject("project-1", "Project");

    const state = session.getSnapshot();
    assert.equal(state.status, "failed");
    assert.deepEqual(state.activeProject, { id: "project-1", name: "Project" });
    assert.match(
      state.persistenceError ?? "",
      /^Project could not be opened because its stored data is invalid\. It was left unchanged/,
    );
    session.flush();
    await delay(0);
    assert.deepEqual(await adapter.inner.projects.load("project-1"), { schemaVersion: 999 });
    session.dispose();
  });

  it("clears the shown notice when asked", async () => {
    const adapter = new ControllablePersistenceAdapter();
    const session = new ProjectSession(adapter);
    await session.selectProject("project-1", "Project");
    await adapter.projects.load("project-1");

    adapter.failNext("project-write");
    session.getSnapshot().store.setPurpose({ purpose: "Fails" });
    session.flush();
    await waitFor("the failed save", () => session.getSnapshot().persistenceError != null);

    session.clearPersistenceError();
    assert.equal(session.getSnapshot().persistenceError, null);
    session.dispose();
  });

  it("clears a failed-save error once a later save succeeds", async () => {
    const adapter = new ControllablePersistenceAdapter();
    const session = new ProjectSession(adapter);
    await session.selectProject("project-1", "Project");
    await adapter.projects.load("project-1");

    adapter.failNext("project-write");
    session.getSnapshot().store.setPurpose({ purpose: "Fails" });
    session.flush();
    await waitFor(
      "the failed save",
      () => session.getSnapshot().persistenceError != null,
    );

    session.getSnapshot().store.setPurpose({ purpose: "Succeeds" });
    session.flush();
    await waitFor(
      "the error to clear",
      () => session.getSnapshot().persistenceError == null,
    );
    session.dispose();
  });

  it("fails to open a project whose stored module snapshot is invalid and leaves it unchanged", async () => {
    const adapter = new ControllablePersistenceAdapter();
    const stored = projectPayload(
      projectRegistry(
        [
          moduleEntry("module-a", "Alpha", {
            ...snapshotWith("Alpha"),
            productOverview: "not an object",
          }),
        ],
        "module-a",
      ),
    );
    await adapter.inner.projects.save("project-1", stored);

    const session = new ProjectSession(adapter);
    await session.selectProject("project-1", "Project");

    assert.equal(session.getSnapshot().status, "failed");
    session.flush();
    await delay(0);
    // As storage holds it: fields left undefined are not stored.
    assert.deepEqual(await adapter.inner.projects.load("project-1"), JSON.parse(JSON.stringify(stored)));
    session.dispose();
  });

  it("creates the legacy module for a project with no stored data", async () => {
    const adapter = new ControllablePersistenceAdapter();
    const session = new ProjectSession(adapter);

    await session.selectProject("project-missing", "Missing");

    const state = session.getSnapshot();
    assert.equal(state.activeProject?.id, "project-missing");
    // The project's name stays the project's: the overview starts blank.
    assert.equal(state.store.productOverview.isEmpty, true);
    assert.equal(state.registry?.activeModuleId, LEGACY_MODULE_ID);
    assert.equal(state.registry?.modulesEnabled, false);
    assert.equal(
      (await storedProject(adapter, "project-missing")).activeModuleId,
      LEGACY_MODULE_ID,
    );
  });

  it("reports the persistence error when a save fails", async () => {
    const adapter = new ControllablePersistenceAdapter();
    adapter.failNext("project-write");
    const session = new ProjectSession(adapter);

    await session.selectProject("project-1", "Project");
    await waitFor(
      "the failed write",
      () => session.getSnapshot().persistenceError != null,
    );

    assert.equal(
      session.getSnapshot().persistenceError,
      "Changes could not be saved in memory. Export the project to avoid losing work.",
    );
  });

  it("ends failed, naming the project, when a project load fails", async () => {
    const adapter = new ControllablePersistenceAdapter();
    await seedProject(
      adapter,
      "project-1",
      projectPayload(
        projectRegistry([moduleEntry("module-a", "Alpha")], "module-a"),
      ),
    );
    adapter.hold("project-load:project-1");

    const session = new ProjectSession(adapter);
    const opened = session.selectProject("project-1", "Project");
    adapter.release(
      "project-load:project-1",
      new Error("Could not read the project."),
    );
    await opened;

    const failed = session.getSnapshot();
    assert.equal(failed.status, "failed");
    assert.deepEqual(failed.activeProject, { id: "project-1", name: "Project" });
    assert.equal(failed.persistenceError, "The project could not be loaded.");
    assert.equal(failed.registry, null);

    // Retrying opens the project once storage answers.
    await session.selectProject("project-1", "Project");
    assert.equal(session.getSnapshot().status, "ready");
  });

  it("keeps the open or opening project when it is selected again", async () => {
    const adapter = new ControllablePersistenceAdapter();
    await seedProject(
      adapter,
      "project-1",
      projectPayload(projectRegistry([moduleEntry("module-a", "Alpha")], "module-a")),
    );
    const session = new ProjectSession(adapter);
    adapter.hold("project-load:project-1");
    const first = session.selectProject("project-1", "Project");
    // A second client asks for the project while it opens: one load serves both.
    const second = session.selectProject("project-1", "Project");
    adapter.release("project-load:project-1");
    await Promise.all([first, second]);
    assert.equal(adapter.projectLoads.length, 1);

    const store = session.getSnapshot().store;
    const statuses: string[] = [];
    const unsubscribe = session.subscribe(() => statuses.push(session.getSnapshot().status));
    await session.selectProject("project-1", "Project");
    unsubscribe();
    assert.equal(session.getSnapshot().store, store);
    assert.deepEqual(statuses, []);
    session.dispose();
  });

  it("names a user-facing load failure in the failed state", async () => {
    const adapter = new ControllablePersistenceAdapter();
    await seedProject(
      adapter,
      "project-1",
      projectPayload(
        projectRegistry([moduleEntry("module-a", "Alpha")], "module-a"),
      ),
    );
    adapter.hold("project-load:project-1");

    const session = new ProjectSession(adapter);
    const opened = session.selectProject("project-1", "Project");
    adapter.release(
      "project-load:project-1",
      new UserFacingError("The project file is not valid JSON."),
    );
    await opened;

    assert.equal(session.getSnapshot().persistenceError, "The project file is not valid JSON.");
  });

  it("keeps the module shown with its timeline detached when its timeline load fails", async () => {
    const adapter = new ControllablePersistenceAdapter();
    await seedProject(
      adapter,
      "project-1",
      projectPayload(
        projectRegistry(
          [
            moduleEntry("module-a", "Alpha", snapshotWith("Alpha")),
            moduleEntry("module-b", "Beta", snapshotWith("Beta")),
          ],
          "module-a",
        ),
      ),
    );
    const storedBetaHistory = await seedTimeline(
      adapter,
      "project-1",
      "module-b",
      "Stored beta history",
    );
    const session = new ProjectSession(adapter);
    await session.selectProject("project-1", "Project");
    adapter.hold("timeline-load:project-1::module-b");

    assert.equal(session.switchModule("module-b"), true);
    session.getSnapshot().store.setPurpose({ purpose: "Beta edited while loading" });
    adapter.release(
      "timeline-load:project-1::module-b",
      new Error("Could not read the module timeline."),
    );
    await delay(0);

    // No rollback: the session and storage both stay on module-b with the
    // edit made while its timeline loaded.
    assert.equal(session.getSnapshot().status, "ready");
    assert.equal(session.getSnapshot().registry?.activeModuleId, "module-b");
    assert.equal(
      session.getSnapshot().store.productOverview.purpose,
      "Beta edited while loading",
    );
    session.flush();
    const stored = await storedProject(adapter, "project-1");
    assert.equal(stored.activeModuleId, "module-b");
    assert.equal(overviewOf(stored).purpose, "Beta edited while loading");

    // The timeline stays detached, so module-b's stored history survives.
    session.getSnapshot().store.setPurpose({ purpose: "After the failure" });
    session.flush();
    await delay(0);
    assert.equal(timelineWritesFor(adapter, "project-1", "module-b").length, 0);
    assert.deepEqual(
      await rawTimeline(adapter, "project-1", "module-b"),
      storedBetaHistory,
    );
  });
});

describe("project session saving", () => {
  it("coalesces snapshot changes and flushes the latest write", async () => {
    const adapter = new ControllablePersistenceAdapter();
    await seedProject(
      adapter,
      "project-1",
      projectPayload(
        projectRegistry([moduleEntry("module-a", "Alpha")], "module-a"),
      ),
    );
    const session = new ProjectSession(adapter);
    await session.selectProject("project-1", "Project");
    adapter.projectWrites.length = 0;

    const store = session.getSnapshot().store;
    store.setPurpose({ purpose: "First purpose" });
    store.setPurpose({ purpose: "Final purpose" });
    assert.equal(adapter.projectWrites.length, 0);

    await delay(PROJECT_SAVE_DEBOUNCE_MS + 100);

    assert.equal(adapter.projectWrites.length, 1);
    const saved = overviewOf(adapter.projectWrites[0].data);
    assert.equal(saved.purpose, "Final purpose");

    store.setPurpose({ purpose: "Second purpose" });
    assert.equal(adapter.projectWrites.length, 1);
    session.flush();
    assert.equal(adapter.projectWrites.length, 2);
    assert.equal(
      overviewOf(adapter.projectWrites[1].data).purpose,
      "Second purpose",
    );

    await delay(PROJECT_SAVE_DEBOUNCE_MS + 100);
    assert.equal(adapter.projectWrites.length, 2);
  });

  it("keeps index entries changed by another tab when saving", async () => {
    const adapter = new ControllablePersistenceAdapter();
    await seedProject(
      adapter,
      "project-1",
      projectPayload(
        projectRegistry([moduleEntry("module-a", "Alpha")], "module-a"),
      ),
      "Project",
    );
    await adapter.inner.projects.saveIndex([
      projectMeta("project-1", "Project"),
      projectMeta("project-2", "Stale copy"),
      projectMeta("project-3", "Another tab"),
    ]);
    const session = new ProjectSession(adapter);
    await session.selectProject("project-1", "Project");
    await adapter.projects.load("project-1");

    // Another tab drops project-2 and adds project-4 while this session is
    // open. The autosave must not restore its stale copy.
    await adapter.inner.projects.saveIndex([
      projectMeta("project-1", "Project"),
      projectMeta("project-3", "Another tab"),
      projectMeta("project-4", "New project"),
    ]);
    session.getSnapshot().store.setPurpose({ purpose: "Newest purpose" });
    session.flush();
    await adapter.projects.load("project-1");

    const projects = await adapter.projects.list();
    assert.deepEqual(
      projects.map((project) => project.id),
      ["project-1", "project-3", "project-4"],
    );
    assert.equal(
      projects.find((project) => project.id === "project-1")?.description,
      "Newest purpose",
    );
  });

  it("leaves the index untouched when the payload write fails", async () => {
    const adapter = new ControllablePersistenceAdapter();
    await seedProject(
      adapter,
      "project-1",
      projectPayload(
        projectRegistry([moduleEntry("module-a", "Alpha")], "module-a"),
      ),
    );
    const session = new ProjectSession(adapter);
    await session.selectProject("project-1", "Project");
    await adapter.projects.load("project-1");
    const projectsBefore = await adapter.inner.projects.list();

    adapter.failNext("project-write");
    session.getSnapshot().store.setPurpose({ purpose: "Will fail" });
    session.flush();
    await waitFor(
      "the failed project write",
      () => session.getSnapshot().persistenceError != null,
    );

    assert.deepEqual(await adapter.inner.projects.list(), projectsBefore);
  });

  it("ignores an earlier write that fails after a later write succeeded", async () => {
    const adapter = new ManualProjectWriteAdapter();
    await adapter.inner.projects.saveIndex([
      projectMeta("project-1", "Project"),
    ]);
    await adapter.inner.projects.save(
      "project-1",
      projectPayload(
        projectRegistry([moduleEntry("module-a", "Alpha")], "module-a"),
      ),
    );
    const session = new ProjectSession(adapter);
    await session.selectProject("project-1", "Project");
    await adapter.settle(0);

    session.getSnapshot().store.setPurpose({ purpose: "First write" });
    session.flush();
    session.getSnapshot().store.setPurpose({ purpose: "Second write" });
    session.flush();
    assert.equal(adapter.pending.length, 2);

    await adapter.settle(1);
    await delay(0);
    assert.equal(session.getSnapshot().persistenceError, null);

    await adapter.settle(0, new Error("Could not save the project."));
    await delay(0);
    assert.equal(
      session.getSnapshot().persistenceError,
      null,
      "the older write must not overwrite the newer result",
    );
  });

  it("flushes the outgoing module before switching", async () => {
    const adapter = new ControllablePersistenceAdapter();
    await seedProject(
      adapter,
      "project-1",
      projectPayload(
        projectRegistry(
          [
            moduleEntry("module-a", "Alpha", snapshotWith("Alpha")),
            moduleEntry("module-b", "Beta", snapshotWith("Beta")),
          ],
          "module-a",
        ),
      ),
    );
    const session = new ProjectSession(adapter);
    await session.selectProject("project-1", "Project");
    adapter.projectWrites.length = 0;

    session.getSnapshot().store.setPurpose({ purpose: "Alpha changed" });
    assert.equal(session.switchModule("module-b"), true);
    await waitForModuleTimeline(adapter, "project-1", "module-b");

    assert.ok(adapter.projectWrites.length >= 2);
    const flushed = adapter.projectWrites[0].data as ProjectPayload;
    assert.equal(flushed.activeModuleId, "module-a");
    assert.equal(overviewOf(flushed).purpose, "Alpha changed");

    const switched = adapter.projectWrites[1].data as ProjectPayload;
    assert.equal(switched.activeModuleId, "module-b");
    assert.equal(labelOf(session.getSnapshot().store), "Beta");
  });

  it("flushes the active module before adding a module", async () => {
    const adapter = new ControllablePersistenceAdapter();
    await seedProject(
      adapter,
      "project-1",
      projectPayload(
        projectRegistry(
          [moduleEntry("module-a", "Alpha", snapshotWith("Alpha"))],
          "module-a",
        ),
      ),
    );
    const session = new ProjectSession(adapter);
    await session.selectProject("project-1", "Project");
    adapter.projectWrites.length = 0;

    session.getSnapshot().store.setPurpose({ purpose: "Alpha changed" });
    session.addModule("Gamma");

    assert.ok(adapter.projectWrites.length >= 2);
    const flushed = adapter.projectWrites[0].data as ProjectPayload;
    assert.equal(flushed.activeModuleId, "module-a");
    assert.equal(overviewOf(flushed).purpose, "Alpha changed");
    const added = session.getSnapshot().registry;
    assert.equal(added?.modules.length, 2);
    assert.equal(
      added?.modules.find((entry) => entry.id === added.activeModuleId)?.name,
      "Gamma",
    );
    assert.equal(session.getSnapshot().store.productOverview.isEmpty, true);
  });

  it("flushes the outgoing project before importing", async () => {
    const adapter = new ControllablePersistenceAdapter();
    await seedProject(
      adapter,
      "project-1",
      projectPayload(
        projectRegistry(
          [moduleEntry("module-a", "Alpha", snapshotWith("Alpha"))],
          "module-a",
        ),
      ),
    );
    const session = new ProjectSession(adapter);
    await session.selectProject("project-1", "Project");
    adapter.projectWrites.length = 0;

    session.getSnapshot().store.setPurpose({ purpose: "Alpha changed" });
    await session.importProjectFile(importedProject());

    const writes = adapter.projectWrites;
    assert.equal(writes.length, 3);
    const flushed = writes[0].data as ProjectPayload;
    assert.equal(flushed.activeModuleId, "module-a");
    assert.equal(overviewOf(flushed).purpose, "Alpha changed");

    const importedSave = writes[1].data as ProjectPayload;
    assert.equal(importedSave.activeModuleId, "module-imported");
    assert.equal(importedSave.modules.length, 1);
    assert.equal(importedSave.modules[0].name, "Imported");
    assert.equal(
      (importedSave.modules[0].snapshot.productOverview as { primaryFeatures: { content: string }[] })
        .primaryFeatures[0]?.content,
      "Imported",
    );

    const reopenedSave = writes[2].data as ProjectPayload;
    assert.equal(reopenedSave.activeModuleId, "module-imported");
    assert.equal(
      session.getSnapshot().registry?.activeModuleId,
      "module-imported",
    );
    assert.equal(labelOf(session.getSnapshot().store), "Imported");
    session.dispose();
  });

  it("does not persist a late mutation on the old store after a module switch", async () => {
    const adapter = new ControllablePersistenceAdapter();
    await seedProject(
      adapter,
      "project-1",
      projectPayload(
        projectRegistry(
          [
            moduleEntry("module-a", "Alpha", snapshotWith("Alpha")),
            moduleEntry("module-b", "Beta", snapshotWith("Beta")),
          ],
          "module-a",
        ),
      ),
    );
    const session = new ProjectSession(adapter);
    await session.selectProject("project-1", "Project");
    const oldStore = session.getSnapshot().store;

    oldStore.setPurpose({ purpose: "Alpha changed" });
    assert.equal(session.switchModule("module-b"), true);
    await waitForModuleTimeline(adapter, "project-1", "module-b");

    const switched = await storedProject(adapter, "project-1");
    assert.equal(switched.activeModuleId, "module-b");
    const alpha = switched.modules.find((entry) => entry.id === "module-a");
    assert.equal(
      (alpha?.snapshot.productOverview as Record<string, unknown>).purpose,
      "Alpha changed",
    );
    const beta = switched.modules.find((entry) => entry.id === "module-b");
    assert.equal(
      storedLabelOf(beta?.snapshot),
      "Beta",
    );

    const savesAfterSwitch = adapter.projectWrites.length;
    oldStore.setPurpose({ purpose: "Late old-store change" });
    session.flush();
    assert.equal(adapter.projectWrites.length, savesAfterSwitch);

    const persisted = await storedProject(adapter, "project-1");
    assert.equal(persisted.activeModuleId, "module-b");
    const persistedBeta = persisted.modules.find(
      (entry) => entry.id === "module-b",
    );
    assert.equal(
      storedLabelOf(persistedBeta?.snapshot),
      "Beta",
    );
    session.dispose();
  });

  it("wires timeline persistence to the active module", async () => {
    const adapter = new ControllablePersistenceAdapter();
    await seedProject(
      adapter,
      "project-1",
      projectPayload(
        projectRegistry(
          [
            moduleEntry("module-a", "Alpha", snapshotWith("Alpha")),
            moduleEntry("module-b", "Beta", snapshotWith("Beta")),
          ],
          "module-a",
        ),
      ),
    );
    const session = new ProjectSession(adapter);
    await session.selectProject("project-1", "Project");

    const alphaKey = "module-a";
    session.getSnapshot().store.setPurpose({ purpose: "Alpha edit" });
    session.flush();
    await waitFor(
      "the alpha timeline write",
      () =>
        timelineWritesFor(adapter, "project-1", alphaKey).some(
          (write) => write.completed,
        ),
    );
    assert.ok(
      timelineContains(
        await storedTimeline(adapter, "project-1", alphaKey),
        "Alpha edit",
      ),
    );

    assert.equal(session.switchModule("module-b"), true);
    await waitForModuleTimeline(adapter, "project-1", "module-b");
    const betaKey = "module-b";
    session.getSnapshot().store.setPurpose({ purpose: "Beta edit" });
    session.flush();
    await waitFor(
      "the beta timeline write",
      () =>
        timelineWritesFor(adapter, "project-1", betaKey).some(
          (write) => write.completed,
        ),
    );
    assert.ok(
      timelineContains(
        await storedTimeline(adapter, "project-1", betaKey),
        "Beta edit",
      ),
    );

    session.backToProjects();
    assert.ok((await storedTimeline(adapter, "project-1", alphaKey)) != null);
    assert.ok((await storedTimeline(adapter, "project-1", betaKey)) != null);
    session.dispose();
  });

  it("leaves storage untouched when an import fails validation", async () => {
    const adapter = new ControllablePersistenceAdapter();
    await seedProject(
      adapter,
      "project-1",
      projectPayload(
        projectRegistry(
          [moduleEntry("module-a", "Alpha", snapshotWith("Alpha"))],
          "module-a",
        ),
      ),
    );
    const session = new ProjectSession(adapter);
    await session.selectProject("project-1", "Project");
    const before = await adapter.inner.projects.load("project-1");
    adapter.projectWrites.length = 0;

    assert.throws(
      () =>
        session.importProjectFile(
          projectPayload(
            projectRegistry(
              [
                moduleEntry("module-bad", "Bad", {
                  ...snapshotWith("Bad"),
                  productOverview: "not an object",
                }),
              ],
              "module-bad",
            ),
          ),
        ),
      /Product overview must be an object/,
    );

    assert.equal(adapter.projectWrites.length, 0);
    assert.deepEqual(await adapter.inner.projects.load("project-1"), before);
    session.dispose();
  });
});

describe("project session leave flushes", () => {
  async function readyProject(): Promise<{
    adapter: ControllablePersistenceAdapter;
    session: ProjectSession;
  }> {
    const adapter = new ControllablePersistenceAdapter();
    await seedProject(
      adapter,
      "project-1",
      projectPayload(
        projectRegistry(
          [
            moduleEntry("module-a", "Alpha", snapshotWith("Alpha")),
            moduleEntry("module-b", "Beta", snapshotWith("Beta")),
          ],
          "module-a",
        ),
      ),
    );
    const session = new ProjectSession(adapter);
    await session.selectProject("project-1", "Project");
    return { adapter, session };
  }

  async function expectQuotaRetry(
    adapter: ControllablePersistenceAdapter,
    leave: () => void,
  ): Promise<void> {
    adapter.failNext("timeline-save");
    leave();
    await waitFor(
      "the old module's quota retry",
      () => timelineWritesFor(adapter, "project-1", "module-a").length === 2,
    );
    const writes = timelineWritesFor(adapter, "project-1", "module-a");
    assert.deepEqual(
      writes.map((write) => write.result),
      [false, true],
    );
    assert.ok(
      timelineContains(
        await rawTimeline(adapter, "project-1", "module-a"),
        "Leaving edit",
      ),
    );
  }

  it("prunes and retries on a module switch", async () => {
    const { adapter, session } = await readyProject();
    session.getSnapshot().store.setPurpose({ purpose: "Leaving edit" });
    await expectQuotaRetry(adapter, () => {
      assert.equal(session.switchModule("module-b"), true);
    });
    session.dispose();
  });

  it("prunes and retries when returning to the project list", async () => {
    const { adapter, session } = await readyProject();
    session.getSnapshot().store.setPurpose({ purpose: "Leaving edit" });
    await expectQuotaRetry(adapter, () => {
      session.backToProjects();
    });
    session.dispose();
  });

  it("prunes and retries when disposing", async () => {
    const { adapter, session } = await readyProject();
    session.getSnapshot().store.setPurpose({ purpose: "Leaving edit" });
    await expectQuotaRetry(adapter, () => {
      session.dispose();
    });
  });
});

describe("project session lifecycle", () => {
  it("keeps snapshot identity stable and notifies subscribers", async () => {
    const adapter = new ControllablePersistenceAdapter();
    const session = new ProjectSession(adapter);
    let notifications = 0;
    const unsubscribe = session.subscribe(() => {
      notifications += 1;
    });

    const initial = session.getSnapshot();
    assert.equal(session.getSnapshot(), initial);
    assert.equal(notifications, 0);

    await session.selectProject("project-1", "Project");
    const changed = session.getSnapshot();
    assert.notEqual(changed, initial);
    assert.equal(session.getSnapshot(), changed);
    assert.ok(notifications > 0);

    const beforeUnsubscribe = notifications;
    unsubscribe();
    session.backToProjects();
    assert.equal(notifications, beforeUnsubscribe);
    session.dispose();
  });

  it("flushes pending writes and then stops autosave", async () => {
    const adapter = new ControllablePersistenceAdapter();
    await seedProject(
      adapter,
      "project-1",
      projectPayload(
        projectRegistry(
          [moduleEntry("module-a", "Alpha", snapshotWith("Alpha"))],
          "module-a",
        ),
      ),
    );
    const session = new ProjectSession(adapter);
    await session.selectProject("project-1", "Project");
    adapter.projectWrites.length = 0;

    const store = session.getSnapshot().store;
    store.setPurpose({ purpose: "Pending write" });
    assert.equal(adapter.projectWrites.length, 0);

    session.dispose();
    assert.equal(adapter.projectWrites.length, 1);
    assert.equal(
      overviewOf(adapter.projectWrites[0].data).purpose,
      "Pending write",
    );

    const timelineWrites = adapter.timelineWrites.length;
    await delay(PROJECT_SAVE_DEBOUNCE_MS + 100);
    assert.equal(adapter.projectWrites.length, 1);
    assert.equal(adapter.timelineWrites.length, timelineWrites);

    session.dispose();
    assert.equal(adapter.projectWrites.length, 1);

    store.setPurpose({ purpose: "After dispose" });
    await delay(PROJECT_SAVE_DEBOUNCE_MS + 100);
    assert.equal(adapter.projectWrites.length, 1);

    session.start();
    store.setPurpose({ purpose: "After restart" });
    session.flush();
    assert.equal(adapter.projectWrites.length, 2);
    assert.equal(
      overviewOf(adapter.projectWrites[1].data).purpose,
      "After restart",
    );
    session.dispose();
  });

  it("restarts the project load cancelled by dispose", async () => {
    const adapter = new ControllablePersistenceAdapter();
    await seedProject(
      adapter,
      "project-1",
      projectPayload(
        projectRegistry(
          [moduleEntry("module-a", "Alpha", snapshotWith("Alpha"))],
          "module-a",
        ),
      ),
    );
    adapter.hold("project-load:project-1");

    const session = new ProjectSession(adapter);
    const first = session.selectProject("project-1", "Project");
    session.dispose();
    session.start();
    adapter.release("project-load:project-1");

    await first;
    await waitForStatus(session, "ready");
    assert.equal(session.getSnapshot().activeProject?.id, "project-1");
    assert.equal(labelOf(session.getSnapshot().store), "Alpha");
  });

  it("restarts a module load after dispose and attaches its history", async () => {
    const adapter = new ControllablePersistenceAdapter();
    const alpha = snapshotWith("Alpha");
    const beta = snapshotWith("Beta");
    await seedProject(
      adapter,
      "project-1",
      projectPayload(
        projectRegistry(
          [
            moduleEntry("module-a", "Alpha", alpha),
            moduleEntry("module-b", "Beta", beta),
          ],
          "module-a",
        ),
      ),
    );
    await seedTimeline(adapter, "project-1", "module-b", "Beta history");

    const session = new ProjectSession(adapter);
    await session.selectProject("project-1", "Project");
    adapter.hold("timeline-load:project-1::module-b");

    assert.equal(session.switchModule("module-b"), true);
    session.dispose();
    session.start();

    const writesBefore = timelineWritesFor(adapter, "project-1", "module-b").length;
    session.getSnapshot().store.setPurpose({ purpose: "Before resume load" });
    session.flush();
    await delay(0);
    assert.equal(
      timelineWritesFor(adapter, "project-1", "module-b").length,
      writesBefore,
      "a module timeline is not saved before its history is loaded",
    );

    adapter.release("timeline-load:project-1::module-b");
    await waitForModuleTimeline(adapter, "project-1", "module-b", 2);
    assert.ok(
      timelineContains(getTimelineSnapshot(), "Beta history"),
      "start re-issues the cancelled load and attaches the loaded history",
    );

    session.getSnapshot().store.setPurpose({ purpose: "After resume load" });
    session.flush();
    await waitFor(
      "the resumed timeline write",
      () =>
        timelineWritesFor(adapter, "project-1", "module-b").length >
        writesBefore,
    );
    assert.ok(
      timelineContains(
        await storedTimeline(adapter, "project-1", "module-b"),
        "After resume load",
      ),
    );
  });
});

describe("project session public API", () => {
  it("exposes the adapter it was constructed with", () => {
    const adapter = new ControllablePersistenceAdapter();
    const session = new ProjectSession(adapter);

    assert.equal(session.persistence, adapter);
    session.dispose();
  });

  it("keeps methods callable when detached from the session", async () => {
    const adapter = new ControllablePersistenceAdapter();
    await seedProject(
      adapter,
      "project-1",
      projectPayload(
        projectRegistry(
          [
            moduleEntry("module-a", "Alpha", snapshotWith("Alpha")),
            moduleEntry("module-b", "Beta", snapshotWith("Beta")),
          ],
          "module-a",
        ),
      ),
    );
    const session = new ProjectSession(adapter);
    const {
      selectProject,
      switchModule,
      addModule,
      recordOpenStep,
      archiveModule,
      backToProjects,
    } = session;

    await selectProject("project-1", "Project");
    assert.equal(session.getSnapshot().activeProject?.id, "project-1");
    assert.equal(session.getSnapshot().registry?.activeModuleId, "module-a");

    assert.equal(switchModule("module-b"), true);
    await waitForModuleTimeline(adapter, "project-1", "module-b");
    assert.equal(session.getSnapshot().registry?.activeModuleId, "module-b");

    addModule("Gamma");
    const activeModuleId = session.getSnapshot().registry?.activeModuleId;
    assert.equal(session.getSnapshot().registry?.modules.length, 3);
    assert.ok(activeModuleId != null);

    recordOpenStep(WorkflowStage.Requirements);
    assert.equal(
      session
        .getSnapshot()
        .registry?.modules.find((entry) => entry.id === activeModuleId)?.openStep,
      WorkflowStage.Requirements,
    );

    archiveModule("module-b");
    assert.ok(
      session
        .getSnapshot()
        .registry?.modules.find((entry) => entry.id === "module-b")?.archivedAt !=
        null,
    );

    backToProjects();
    assert.equal(session.getSnapshot().activeProject, null);
  });
});

describe("project session module registry", () => {
  it("rejects empty and duplicate names without writing", async () => {
    const adapter = new ControllablePersistenceAdapter();
    await seedProject(
      adapter,
      "project-1",
      projectPayload(
        projectRegistry(
          [moduleEntry("module-a", "Alpha", snapshotWith("Alpha"))],
          "module-a",
          false,
        ),
      ),
    );
    const session = new ProjectSession(adapter);
    await session.selectProject("project-1", "Project");
    const before = await adapter.inner.projects.load("project-1");
    adapter.projectWrites.length = 0;

    assert.throws(() => session.enableModules("   "), /cannot be empty/);
    assert.throws(() => session.enableModules("alpha"), /already exists/);
    assert.throws(() => session.addModule(""), /cannot be empty/);
    assert.throws(() => session.addModule("ALPHA"), /already exists/);

    assert.equal(adapter.projectWrites.length, 0);
    assert.deepEqual(await adapter.inner.projects.load("project-1"), before);
    session.dispose();
  });

  it("renames a module under the same rules as naming one, keeping its work", async () => {
    const adapter = new ControllablePersistenceAdapter();
    await seedProject(
      adapter,
      "project-1",
      projectPayload(
        projectRegistry([moduleEntry("module-a", "Alpha"), moduleEntry("module-b", "Beta")], "module-a"),
      ),
    );
    const session = new ProjectSession(adapter);
    await session.selectProject("project-1", "Project");

    assert.throws(() => session.renameModule("module-a", "  "), /cannot be empty/);
    assert.throws(() => session.renameModule("module-a", "beta"), /already exists/);
    session.renameModule("module-a", "alpha");
    session.renameModule("module-b", "Billing");

    assert.deepEqual(session.getSnapshot().registry?.modules.map(({ name }) => name), ["alpha", "Billing"]);
    assert.equal(labelOf(session.getSnapshot().store), "Alpha");
    session.flush();
    const stored = await storedProject(adapter, "project-1");
    assert.deepEqual(stored.modules.map(({ name }) => name), ["alpha", "Billing"]);
    session.dispose();
  });

  it("renames the project in the projects index, refusing a name another project has", async () => {
    const adapter = new ControllablePersistenceAdapter();
    await seedProject(adapter, "project-1", projectPayload(projectRegistry([moduleEntry("module-a", "Alpha")], "module-a")));
    await adapter.inner.projects.saveIndex([projectMeta("project-1", "Project"), projectMeta("project-2", "Garden")]);
    const session = new ProjectSession(adapter);
    await session.selectProject("project-1", "Project");

    await assert.rejects(session.renameProject(" "), /Name the project\./);
    await assert.rejects(session.renameProject("garden"), /A project named “garden” already exists\./);
    await session.renameProject("Plant Pal");

    assert.deepEqual(session.getSnapshot().activeProject, { id: "project-1", name: "Plant Pal" });
    assert.deepEqual((await adapter.inner.projects.list()).map(({ name }) => name), ["Plant Pal", "Garden"]);
    session.dispose();
  });

  it("keeps a recovery snapshot of the state before a stage reopens", async () => {
    const adapter = new ControllablePersistenceAdapter();
    await seedProject(adapter, "project-1", projectPayload(projectRegistry([moduleEntry("module-a", "Alpha")], "module-a")));
    const session = new ProjectSession(adapter);
    await session.selectProject("project-1", "Project");

    session.getSnapshot().store!.eventTarget.emit("reopen", { label: "User Stories", before: { marker: 1 } });
    let saved: { label: string; data: unknown }[] = [];
    await waitFor("the recovery snapshot", () => {
      void adapter.revisions.list("project-1", "module-a").then((revisions) => {
        saved = revisions;
      });
      return saved.length > 0;
    });
    assert.deepEqual(saved.map(({ label, data }) => ({ label, data })), [
      { label: "Before reopening User Stories", data: { marker: 1 } },
    ]);
    session.dispose();
  });

  it("archives only a visible, non-active module", async () => {
    const adapter = new ControllablePersistenceAdapter();
    await seedProject(
      adapter,
      "project-1",
      projectPayload(
        projectRegistry(
          [
            moduleEntry("module-a", "Alpha"),
            moduleEntry("module-b", "Beta"),
            moduleEntry("module-c", "Gamma"),
          ],
          "module-a",
        ),
      ),
    );
    const session = new ProjectSession(adapter);
    await session.selectProject("project-1", "Project");

    session.archiveModule("module-a");
    assert.equal(
      session.getSnapshot().registry?.modules.find(
        (entry) => entry.id === "module-a",
      )?.archivedAt,
      null,
    );

    session.archiveModule("missing");
    assert.equal(session.getSnapshot().registry?.modules.length, 3);

    session.archiveModule("module-b");
    const archived = session
      .getSnapshot()
      .registry?.modules.find((entry) => entry.id === "module-b");
    assert.ok(archived?.archivedAt != null);
    assert.deepEqual(
      visibleModules(session.getSnapshot().registry!).map((entry) => entry.id),
      ["module-a", "module-c"],
    );
  });

  it("records open steps only while modules are enabled", async () => {
    const adapter = new ControllablePersistenceAdapter();
    const session = new ProjectSession(adapter);
    await session.selectProject("project-1", "Project");

    session.recordOpenStep(WorkflowStage.Requirements);
    assert.equal(
      session.getSnapshot().registry?.modules[0].openStep,
      WorkflowStage.ProductOverview,
    );

    session.enableModules("Alpha");
    session.recordOpenStep(WorkflowStage.Requirements);
    assert.equal(
      session.getSnapshot().registry?.modules[0].openStep,
      WorkflowStage.Requirements,
    );
    assert.equal(session.getSnapshot().registry?.modules[0].name, "Alpha");
  });

  it("drops a pending overview seed when another project opens", async () => {
    const adapter = new ControllablePersistenceAdapter();
    await seedProject(
      adapter,
      "project-a",
      projectPayload(
        projectRegistry([moduleEntry("module-a", "Alpha")], "module-a"),
      ),
    );
    await seedProject(
      adapter,
      "project-b",
      projectPayload(
        projectRegistry([moduleEntry("module-b", "Beta")], "module-b"),
      ),
    );
    const session = new ProjectSession(adapter);

    adapter.hold("project-load:project-a");
    const abandoned = session.selectProject("project-a", "Alpha", {
      overviewSeed: "Seed for alpha",
    });
    await session.selectProject("project-b", "Beta");
    adapter.release("project-load:project-a");
    await abandoned;
    await session.selectProject("project-a", "Alpha");

    // A seed must never draft an overview for a project reopened later.
    assert.equal(session.consumeOverviewSeed("project-a"), null);
    session.dispose();
  });

  it("keeps a pending overview seed when the same project is selected again", async () => {
    const adapter = new ControllablePersistenceAdapter();
    const session = new ProjectSession(adapter);

    adapter.hold("project-load:project-a");
    void session.selectProject("project-a", "Alpha", {
      overviewSeed: "Seed for alpha",
    });
    adapter.release("project-load:project-a");
    await session.selectProject("project-a", "Alpha");

    assert.equal(session.consumeOverviewSeed("project-a"), "Seed for alpha");
    session.dispose();
  });

  it("drops a pending overview seed when returning to the project list", async () => {
    const session = new ProjectSession(new ControllablePersistenceAdapter());
    await session.selectProject("project-a", "Alpha", {
      overviewSeed: "Seed for alpha",
    });

    session.backToProjects();

    assert.equal(session.consumeOverviewSeed("project-a"), null);
  });
});

describe("project session async loading races", () => {
  it("drops a superseded project load when another project opens", async () => {
    const adapter = new ControllablePersistenceAdapter();
    await seedProject(
      adapter,
      "project-a",
      projectPayload(
        projectRegistry(
          [moduleEntry("module-a", "Alpha", snapshotWith("Alpha project"))],
          "module-a",
        ),
      ),
      "Alpha",
    );
    await seedProject(
      adapter,
      "project-b",
      projectPayload(
        projectRegistry(
          [moduleEntry("module-b", "Beta", snapshotWith("Beta project"))],
          "module-b",
        ),
      ),
      "Beta",
    );
    adapter.hold("project-load:project-a");

    const session = new ProjectSession(adapter);
    const first = session.selectProject("project-a", "Alpha");
    const second = session.selectProject("project-b", "Beta");
    await second;

    assert.equal(session.getSnapshot().status, "ready");
    assert.equal(session.getSnapshot().activeProject?.id, "project-b");
    assert.equal(labelOf(session.getSnapshot().store), "Beta project");
    assert.equal(session.getSnapshot().registry?.activeModuleId, "module-b");
    assert.equal(session.getSnapshot().persistenceError, null);

    adapter.release("project-load:project-a");
    await first;

    assert.equal(session.getSnapshot().activeProject?.id, "project-b");
    assert.equal(labelOf(session.getSnapshot().store), "Beta project");
    assert.equal(session.getSnapshot().registry?.activeModuleId, "module-b");
    assert.equal(session.getSnapshot().persistenceError, null);
    assert.equal(
      await storedTimeline(adapter, "project-a", "module-a"),
      null,
    );
  });

  it("drops a project timeline load that finishes after another project opens", async () => {
    const adapter = new ControllablePersistenceAdapter();
    await seedProject(
      adapter,
      "project-a",
      projectPayload(
        projectRegistry(
          [moduleEntry("module-a", "Alpha", snapshotWith("Alpha"))],
          "module-a",
        ),
      ),
    );
    await seedProject(
      adapter,
      "project-b",
      projectPayload(
        projectRegistry(
          [moduleEntry("module-b", "Beta", snapshotWith("Beta"))],
          "module-b",
        ),
      ),
    );
    adapter.hold("timeline-load:project-a::module-a");

    const session = new ProjectSession(adapter);
    const first = session.selectProject("project-a", "Alpha");
    await waitFor(
      "the first payload load",
      () =>
        adapter.projectLoads.some(
          (load) => load.id === "project-a" && load.completed,
        ),
    );
    await session.selectProject("project-b", "Beta");
    adapter.release("timeline-load:project-a::module-a");
    await first;

    assert.equal(session.getSnapshot().activeProject?.id, "project-b");
    assert.equal(labelOf(session.getSnapshot().store), "Beta");
  });

  it("drops a project load that finishes after backToProjects", async () => {
    const adapter = new ControllablePersistenceAdapter();
    await seedProject(
      adapter,
      "project-a",
      projectPayload(
        projectRegistry(
          [moduleEntry("module-a", "Alpha", snapshotWith("Alpha"))],
          "module-a",
        ),
      ),
    );
    adapter.hold("project-load:project-a");

    const session = new ProjectSession(adapter);
    const opened = session.selectProject("project-a", "Alpha");
    session.backToProjects();
    adapter.release("project-load:project-a");
    await opened;

    assert.equal(session.getSnapshot().status, "idle");
    assert.equal(session.getSnapshot().activeProject, null);
    assert.equal(session.getSnapshot().registry, null);
  });

  it("drops a project load that finishes after dispose and restarts it", async () => {
    const adapter = new ControllablePersistenceAdapter();
    await seedProject(
      adapter,
      "project-a",
      projectPayload(
        projectRegistry(
          [moduleEntry("module-a", "Alpha", snapshotWith("Alpha"))],
          "module-a",
        ),
      ),
    );
    adapter.hold("project-load:project-a");

    const session = new ProjectSession(adapter);
    const opened = session.selectProject("project-a", "Alpha");
    session.dispose();
    session.start();
    adapter.release("project-load:project-a");
    await opened;
    await waitForStatus(session, "ready");

    assert.equal(session.getSnapshot().activeProject?.id, "project-a");
    assert.equal(session.getSnapshot().registry?.activeModuleId, "module-a");
  });

  it("keeps the module ready while the target timeline loads", async () => {
    const adapter = new ControllablePersistenceAdapter();
    const alpha = snapshotWith("Alpha");
    const beta = snapshotWith("Beta");
    await seedProject(
      adapter,
      "project-1",
      projectPayload(
        projectRegistry(
          [
            moduleEntry("module-a", "Alpha", alpha),
            moduleEntry("module-b", "Beta", beta),
          ],
          "module-a",
        ),
      ),
    );
    await seedTimeline(adapter, "project-1", "module-b", "Beta stored history");
    const session = new ProjectSession(adapter);
    await session.selectProject("project-1", "Project");
    adapter.hold("timeline-load:project-1::module-b");

    assert.equal(session.switchModule("module-b"), true);
    assert.equal(session.getSnapshot().status, "ready");
    assert.equal(session.getSnapshot().registry?.activeModuleId, "module-b");
    assert.equal(labelOf(session.getSnapshot().store), "Beta");

    session.getSnapshot().store.setPurpose({ purpose: "Before load" });
    session.flush();
    await delay(0);
    assert.equal(
      timelineWritesFor(adapter, "project-1", "module-b").length,
      0,
      "the target store neither records nor saves before its history loads",
    );

    adapter.release("timeline-load:project-1::module-b");
    await waitForModuleTimeline(adapter, "project-1", "module-b");
    assert.ok(timelineContains(getTimelineSnapshot(), "Beta stored history"));

    session.getSnapshot().store.setPurpose({ purpose: "After load" });
    session.flush();
    await waitFor(
      "the target module's timeline write",
      () => timelineWritesFor(adapter, "project-1", "module-b").length > 0,
    );
    assert.ok(
      timelineContains(
        await storedTimeline(adapter, "project-1", "module-b"),
        "After load",
      ),
    );
  });

  it("uses the last module switch when a stale load resolves first", async () => {
    const adapter = new ControllablePersistenceAdapter();
    await seedProject(
      adapter,
      "project-1",
      projectPayload(
        projectRegistry(
          [
            moduleEntry("module-a", "Alpha", snapshotWith("Alpha")),
            moduleEntry("module-b", "Beta", snapshotWith("Beta")),
            moduleEntry("module-c", "Gamma", snapshotWith("Gamma")),
          ],
          "module-a",
        ),
      ),
    );
    const session = new ProjectSession(adapter);
    await session.selectProject("project-1", "Project");
    adapter.hold("timeline-load:project-1::module-b");
    adapter.hold("timeline-load:project-1::module-c");

    assert.equal(session.switchModule("module-b"), true);
    assert.equal(session.switchModule("module-c"), true);
    adapter.release("timeline-load:project-1::module-b");
    await waitForModuleTimeline(adapter, "project-1", "module-b");
    assert.equal(session.getSnapshot().registry?.activeModuleId, "module-c");

    const writesBefore = timelineWritesFor(
      adapter,
      "project-1",
      "module-b",
    ).length;
    session.getSnapshot().store.setPurpose({ purpose: "Gamma edit" });
    session.flush();
    await delay(0);
    assert.equal(
      timelineWritesFor(adapter, "project-1", "module-b").length,
      writesBefore,
      "the stale B load must not attach B's timeline to C's store",
    );

    adapter.release("timeline-load:project-1::module-c");
    await waitForModuleTimeline(adapter, "project-1", "module-c");
    session.getSnapshot().store.setPurpose({ purpose: "Gamma after load" });
    session.flush();
    await waitFor(
      "the gamma timeline write",
      () => timelineWritesFor(adapter, "project-1", "module-c").length > 0,
    );
    assert.equal(session.getSnapshot().registry?.activeModuleId, "module-c");
    assert.equal(labelOf(session.getSnapshot().store), "Gamma");
  });

  it("uses the last module switch when a stale load resolves last", async () => {
    const adapter = new ControllablePersistenceAdapter();
    await seedProject(
      adapter,
      "project-1",
      projectPayload(
        projectRegistry(
          [
            moduleEntry("module-a", "Alpha", snapshotWith("Alpha")),
            moduleEntry("module-b", "Beta", snapshotWith("Beta")),
            moduleEntry("module-c", "Gamma", snapshotWith("Gamma")),
          ],
          "module-a",
        ),
      ),
    );
    const session = new ProjectSession(adapter);
    await session.selectProject("project-1", "Project");
    adapter.hold("timeline-load:project-1::module-b");

    assert.equal(session.switchModule("module-b"), true);
    assert.equal(session.switchModule("module-c"), true);
    await waitForModuleTimeline(adapter, "project-1", "module-c");
    assert.equal(session.getSnapshot().registry?.activeModuleId, "module-c");

    adapter.release("timeline-load:project-1::module-b");
    await waitForModuleTimeline(adapter, "project-1", "module-b");
    assert.equal(session.getSnapshot().registry?.activeModuleId, "module-c");
    assert.equal(labelOf(session.getSnapshot().store), "Gamma");
  });

  it("drops a stale module load from another project", async () => {
    const adapter = new ControllablePersistenceAdapter();
    const alpha = snapshotWith("Alpha");
    const beta = snapshotWith("Beta");
    await seedProject(
      adapter,
      "project-one",
      projectPayload(
        projectRegistry(
          [
            moduleEntry("module-a", "Alpha", alpha),
            moduleEntry("module-b", "Beta", beta),
          ],
          "module-a",
        ),
      ),
      "One",
    );
    await seedProject(
      adapter,
      "project-two",
      projectPayload(
        projectRegistry(
          [
            moduleEntry("module-a", "Alpha", alpha),
            moduleEntry("module-b", "Beta", beta),
          ],
          "module-a",
        ),
      ),
      "Two",
    );
    const session = new ProjectSession(adapter);
    await session.selectProject("project-one", "One");
    adapter.hold("timeline-load:project-one::module-b");
    assert.equal(session.switchModule("module-b"), true);

    await session.selectProject("project-two", "Two");
    adapter.hold("timeline-load:project-two::module-b");
    assert.equal(session.switchModule("module-b"), true);

    adapter.release("timeline-load:project-one::module-b");
    await waitForModuleTimeline(adapter, "project-one", "module-b");
    const writesBefore = timelineWritesFor(
      adapter,
      "project-one",
      "module-b",
    ).length;
    session.getSnapshot().store.setPurpose({ purpose: "Project two edit" });
    session.flush();
    await delay(0);
    assert.equal(
      timelineWritesFor(adapter, "project-one", "module-b").length,
      writesBefore,
      "a stale load from project one must not save project two under it",
    );

    adapter.release("timeline-load:project-two::module-b");
    await waitForModuleTimeline(adapter, "project-two", "module-b");
    session.getSnapshot().store.setPurpose({ purpose: "Project two saved" });
    session.flush();
    await waitFor(
      "the project two timeline write",
      () =>
        timelineWritesFor(adapter, "project-two", "module-b").length > 0,
    );
    assert.equal(session.getSnapshot().activeProject?.id, "project-two");
  });

  it("retries a timeline save on its captured target after another project opens", async () => {
    const adapter = new ControllablePersistenceAdapter();
    await seedProject(
      adapter,
      "project-1",
      projectPayload(
        projectRegistry(
          [moduleEntry("module-a", "Alpha", snapshotWith("Alpha"))],
          "module-a",
        ),
      ),
    );
    await seedProject(
      adapter,
      "project-2",
      projectPayload(
        projectRegistry(
          [moduleEntry("module-other", "Other", snapshotWith("Other"))],
          "module-other",
        ),
      ),
      "Other",
    );
    const session = new ProjectSession(adapter);
    await session.selectProject("project-1", "Project");
    session.getSnapshot().store.setPurpose({ purpose: "Timeline edit" });

    adapter.failNext("timeline-save");
    await session.selectProject("project-2", "Other");
    await waitFor(
      "the captured-target retry",
      () => timelineWritesFor(adapter, "project-1", "module-a").length >= 2,
    );

    const writes = timelineWritesFor(adapter, "project-1", "module-a");
    assert.equal(writes[0].result, false);
    assert.equal(writes[1].result, true);
    assert.equal(session.getSnapshot().activeProject?.id, "project-2");
  });

  it("ignores a project-write failure after another project opened", async () => {
    const adapter = new ControllablePersistenceAdapter();
    await seedProject(
      adapter,
      "project-a",
      projectPayload(
        projectRegistry(
          [moduleEntry("module-a", "Alpha", snapshotWith("Alpha"))],
          "module-a",
        ),
      ),
      "Alpha",
    );
    await seedProject(
      adapter,
      "project-b",
      projectPayload(
        projectRegistry(
          [moduleEntry("module-b", "Beta", snapshotWith("Beta"))],
          "module-b",
        ),
      ),
      "Beta",
    );
    adapter.hold("project-save:project-a");

    const session = new ProjectSession(adapter);
    await session.selectProject("project-a", "Alpha");
    await session.selectProject("project-b", "Beta");
    assert.equal(session.getSnapshot().persistenceError, null);

    adapter.release(
      "project-save:project-a",
      new Error("Could not save the project."),
    );
    await delay(0);

    assert.equal(session.getSnapshot().activeProject?.id, "project-b");
    assert.equal(session.getSnapshot().persistenceError, null);
  });
});

describe("project session import failures and races", () => {
  it("rejects a failed import, restores the old session, and keeps saving", async () => {
    const adapter = new ControllablePersistenceAdapter();
    await seedProject(
      adapter,
      "project-1",
      projectPayload(
        projectRegistry(
          [moduleEntry("module-a", "Alpha", snapshotWith("Alpha"))],
          "module-a",
        ),
      ),
    );
    const session = new ProjectSession(adapter);
    await session.selectProject("project-1", "Project");
    await adapter.projects.load("project-1");
    const storedBefore = await adapter.inner.projects.load("project-1");

    adapter.failNext("project-write");
    await assert.rejects(
      session.importProjectFile(importedProject()),
      /Could not save the project/,
    );

    assert.equal(session.getSnapshot().status, "ready");
    assert.equal(session.getSnapshot().activeProject?.id, "project-1");
    assert.equal(session.getSnapshot().registry?.activeModuleId, "module-a");
    assert.equal(labelOf(session.getSnapshot().store), "Alpha");
    assert.deepEqual(await adapter.inner.projects.load("project-1"), storedBefore);

    const writesBefore = adapter.projectWrites.length;
    session.getSnapshot().store.setPurpose({ purpose: "After failed import" });
    session.flush();
    await waitFor(
      "the autosave after a failed import",
      () => adapter.projectWrites.length > writesBefore,
    );
    assert.equal(
      overviewOf(adapter.projectWrites.at(-1)!.data).purpose,
      "After failed import",
    );

    const timelineBefore = timelineWritesFor(
      adapter,
      "project-1",
      "module-a",
    ).length;
    adapter.failNext("timeline-save");
    session.getSnapshot().store.setPurpose({
      purpose: "Timeline after failed import",
    });
    session.flush();
    await waitFor(
      "the timeline retry after a failed import",
      () =>
        timelineWritesFor(adapter, "project-1", "module-a").length >=
        timelineBefore + 2,
    );
    assert.deepEqual(
      timelineWritesFor(adapter, "project-1", "module-a")
        .slice(timelineBefore)
        .map((write) => write.result),
      [false, true],
    );
  });

  it("refuses a module switch while the import write is in flight", async () => {
    const adapter = new ControllablePersistenceAdapter();
    await seedProject(
      adapter,
      "project-1",
      projectPayload(
        projectRegistry(
          [
            moduleEntry("module-a", "Alpha", snapshotWith("Alpha")),
            moduleEntry("module-b", "Beta", snapshotWith("Beta")),
          ],
          "module-a",
        ),
      ),
    );
    const session = new ProjectSession(adapter);
    await session.selectProject("project-1", "Project");
    await adapter.projects.load("project-1");
    adapter.hold("project-save:project-1");

    const importing = session.importProjectFile(importedProject());
    // The page stays mounted on the current module while the write runs.
    assert.equal(session.getSnapshot().status, "ready");
    assert.equal(session.getSnapshot().registry?.activeModuleId, "module-a");
    assert.equal(labelOf(session.getSnapshot().store), "Alpha");
    assert.equal(session.switchModule("module-b"), false);
    // Autosave is paused, so the old state cannot overwrite the import.
    const writesBefore = adapter.projectWrites.length;
    session.getSnapshot().store.setPurpose({ purpose: "Edited during import" });
    session.flush();
    assert.equal(adapter.projectWrites.length, writesBefore);

    adapter.release("project-save:project-1");
    await importing;
    assert.equal(session.getSnapshot().status, "ready");
    assert.equal(session.getSnapshot().registry?.activeModuleId, "module-imported");
    assert.equal(labelOf(session.getSnapshot().store), "Imported");
  });

  it("drops a stale import write success after another project opens", async () => {
    const adapter = new ControllablePersistenceAdapter();
    await seedProject(
      adapter,
      "project-1",
      projectPayload(
        projectRegistry(
          [moduleEntry("module-a", "Alpha", snapshotWith("Alpha"))],
          "module-a",
        ),
      ),
    );
    await seedProject(
      adapter,
      "project-2",
      projectPayload(
        projectRegistry(
          [moduleEntry("module-b", "Beta", snapshotWith("Beta"))],
          "module-b",
        ),
      ),
      "Other",
    );
    const session = new ProjectSession(adapter);
    await session.selectProject("project-1", "Project");
    await adapter.projects.load("project-1");
    adapter.hold("project-save:project-1");

    const importing = session.importProjectFile(importedProject());
    await session.selectProject("project-2", "Other");
    adapter.release("project-save:project-1");
    await importing;

    assert.equal(session.getSnapshot().activeProject?.id, "project-2");
    assert.equal(session.getSnapshot().registry?.activeModuleId, "module-b");
    assert.equal(labelOf(session.getSnapshot().store), "Beta");
  });

  it("drops a stale import write failure after another project opens", async () => {
    const adapter = new ControllablePersistenceAdapter();
    await seedProject(
      adapter,
      "project-1",
      projectPayload(
        projectRegistry(
          [moduleEntry("module-a", "Alpha", snapshotWith("Alpha"))],
          "module-a",
        ),
      ),
    );
    await seedProject(
      adapter,
      "project-2",
      projectPayload(
        projectRegistry(
          [moduleEntry("module-b", "Beta", snapshotWith("Beta"))],
          "module-b",
        ),
      ),
      "Other",
    );
    const session = new ProjectSession(adapter);
    await session.selectProject("project-1", "Project");
    await adapter.projects.load("project-1");
    adapter.hold("project-save:project-1");

    const importing = session.importProjectFile(importedProject());
    await session.selectProject("project-2", "Other");
    adapter.release(
      "project-save:project-1",
      new Error("Could not save the project."),
    );
    await assert.rejects(importing, /Could not save the project/);

    assert.equal(session.getSnapshot().activeProject?.id, "project-2");
    assert.equal(labelOf(session.getSnapshot().store), "Beta");
    assert.equal(session.getSnapshot().persistenceError, null);
  });

  it("drops a stale import timeline load after another project opens", async () => {
    const adapter = new ControllablePersistenceAdapter();
    await seedProject(
      adapter,
      "project-1",
      projectPayload(
        projectRegistry(
          [moduleEntry("module-a", "Alpha", snapshotWith("Alpha"))],
          "module-a",
        ),
      ),
    );
    await seedProject(
      adapter,
      "project-2",
      projectPayload(
        projectRegistry(
          [moduleEntry("module-b", "Beta", snapshotWith("Beta"))],
          "module-b",
        ),
      ),
      "Other",
    );
    const session = new ProjectSession(adapter);
    await session.selectProject("project-1", "Project");
    adapter.hold("timeline-load:project-1::module-imported");

    const importing = session.importProjectFile(importedProject());
    await waitFor(
      "the imported payload write",
      () =>
        adapter.projectWrites.some(
          (write) =>
            write.id === "project-1" &&
            (write.data as ProjectPayload).activeModuleId === "module-imported",
        ),
    );
    await session.selectProject("project-2", "Other");
    adapter.release("timeline-load:project-1::module-imported");
    await importing;

    assert.equal(session.getSnapshot().activeProject?.id, "project-2");
    assert.equal(session.getSnapshot().registry?.activeModuleId, "module-b");
    assert.equal(labelOf(session.getSnapshot().store), "Beta");
  });
});

describe("project session synchronous flush", () => {
  it("writes module, add, archive, timeline, and import changes before flush returns", async () => {
    const { localStorage } = installFakeWebEnvironment();
    const persistence = new WebPersistenceAdapter();
    await persistence.projects.saveIndex([
      projectMeta("project-1", "Project"),
    ]);
    await persistence.projects.save(
      "project-1",
      projectPayload(
        projectRegistry(
          [
            moduleEntry("module-a", "Alpha", snapshotWith("Alpha")),
            moduleEntry("module-b", "Beta", snapshotWith("Beta")),
          ],
          "module-a",
        ),
      ),
    );

    const session = new ProjectSession(persistence);
    await session.selectProject("project-1", "Project");
    const store = session.getSnapshot().store;
    store.setPurpose({ purpose: "Alpha timeline" });
    session.flush();
    assert.ok(
      localStorage
        .getItem("requireganizer:timeline:project-1::module-a")
        ?.includes("Alpha timeline"),
    );

    store.setPurpose({ purpose: "Alpha outgoing" });
    assert.equal(session.switchModule("module-b"), true);
    await delay(0);
    const switched = JSON.parse(
      localStorage.getItem("requireganizer:project:project-1")!,
    ) as ProjectPayload;
    assert.equal(switched.activeModuleId, "module-b");
    assert.equal(
      (switched.modules.find((entry) => entry.id === "module-a")?.snapshot
        .productOverview as Record<string, unknown>).purpose,
      "Alpha outgoing",
    );

    session.getSnapshot().store.setPurpose({ purpose: "Beta timeline" });
    session.flush();
    assert.ok(
      localStorage
        .getItem("requireganizer:timeline:project-1::module-b")
        ?.includes("Beta timeline"),
    );

    session.addModule("Gamma");
    session.flush();
    const added = JSON.parse(
      localStorage.getItem("requireganizer:project:project-1")!,
    ) as ProjectPayload;
    assert.equal(added.modules.length, 3);

    session.archiveModule("module-b");
    session.flush();
    const archived = JSON.parse(
      localStorage.getItem("requireganizer:project:project-1")!,
    ) as ProjectPayload;
    assert.ok(
      archived.modules.find((entry) => entry.id === "module-b")?.archivedAt !=
        null,
    );

    const importing = session.importProjectFile(importedProject());
    session.flush();
    const imported = JSON.parse(
      localStorage.getItem("requireganizer:project:project-1")!,
    ) as ProjectPayload;
    assert.equal(imported.activeModuleId, "module-imported");
    await importing;
    assert.equal(session.getSnapshot().status, "ready");
    assert.equal(
      session.getSnapshot().registry?.activeModuleId,
      "module-imported",
    );
  });
});

describe("project session outgoing timeline writes", () => {
  async function editedProject(): Promise<{
    adapter: ControllablePersistenceAdapter;
    session: ProjectSession;
  }> {
    const adapter = new ControllablePersistenceAdapter();
    await seedProject(
      adapter,
      "project-1",
      projectPayload(
        projectRegistry(
          [
            moduleEntry("module-a", "Alpha", snapshotWith("Alpha")),
            moduleEntry("module-b", "Beta", snapshotWith("Beta")),
          ],
          "module-a",
        ),
      ),
    );
    const session = new ProjectSession(adapter);
    await session.selectProject("project-1", "Project");
    session.getSnapshot().store.setPurpose({ purpose: "Outgoing history" });
    assert.equal(timelineWritesFor(adapter, "project-1", "module-a").length, 0);
    return { adapter, session };
  }

  function assertOutgoingTimelineIssued(
    adapter: ControllablePersistenceAdapter,
  ): void {
    const writes = timelineWritesFor(adapter, "project-1", "module-a");
    assert.equal(writes.length, 1);
    assert.ok(
      timelineContains(
        writes[0].data as Record<string, unknown>,
        "Outgoing history",
      ),
    );
  }

  const leaves: Array<[string, (session: ProjectSession) => unknown]> = [
    ["a module switch", (session) => session.switchModule("module-b")],
    ["adding a module", (session) => session.addModule("Gamma")],
    ["opening another project", (session) =>
      session.selectProject("project-2", "Other")],
    ["returning to the project list", (session) => session.backToProjects()],
    ["an import", (session) => session.importProjectFile(importedProject())],
  ];

  for (const [description, leave] of leaves) {
    it(`issues the outgoing module's timeline write before ${description} returns`, async () => {
      const { adapter, session } = await editedProject();
      const settled = leave(session);
      // No await: the write must already be issued.
      assertOutgoingTimelineIssued(adapter);
      await settled;
      session.dispose();
    });
  }
});

describe("project session stored history and reloads", () => {
  async function seededProject(): Promise<ControllablePersistenceAdapter> {
    const adapter = new ControllablePersistenceAdapter();
    await seedProject(
      adapter,
      "project-1",
      projectPayload(
        projectRegistry(
          [
            moduleEntry("module-a", "Alpha", snapshotWith("Alpha")),
            moduleEntry("module-b", "Beta", snapshotWith("Beta")),
          ],
          "module-a",
        ),
      ),
    );
    await seedTimeline(adapter, "project-1", "module-a", "Stored alpha history");
    await seedTimeline(adapter, "project-1", "module-b", "Stored beta history");
    return adapter;
  }

  it("restores the active module's stored history when a project opens", async () => {
    const adapter = await seededProject();
    const session = new ProjectSession(adapter);
    await session.selectProject("project-1", "Project");

    assert.ok(timelineContains(getTimelineSnapshot(), "Stored alpha history"));
    session.dispose();
  });

  it("restores the imported module's stored history after an import", async () => {
    const adapter = await seededProject();
    await seedTimeline(
      adapter,
      "project-1",
      "module-imported",
      "Stored imported history",
    );
    const session = new ProjectSession(adapter);
    await session.selectProject("project-1", "Project");

    await session.importProjectFile(importedProject());

    assert.equal(session.getSnapshot().registry?.activeModuleId, "module-imported");
    assert.ok(timelineContains(getTimelineSnapshot(), "Stored imported history"));
    session.dispose();
  });

  it("reloads the store of a ready session and restores its history", async () => {
    const adapter = await seededProject();
    const session = new ProjectSession(adapter);
    await session.selectProject("project-1", "Project");
    const before = session.getSnapshot().store;
    before.setPurpose({ purpose: "Alpha before reload" });

    session.reloadStore();
    const reloaded = session.getSnapshot().store;
    assert.notEqual(reloaded, before);
    assert.equal(session.getSnapshot().status, "ready");
    assert.equal(reloaded.productOverview.purpose, "Alpha before reload");
    await waitForModuleTimeline(adapter, "project-1", "module-a", 2);

    assert.ok(timelineContains(getTimelineSnapshot(), "Stored alpha history"));
    reloaded.setPurpose({ purpose: "After reload" });
    session.flush();
    assert.ok(
      timelineContains(
        timelineWritesFor(adapter, "project-1", "module-a").at(-1)!
          .data as Record<string, unknown>,
        "After reload",
      ),
    );
    session.dispose();
  });

  it("reloads the store of an idle session", () => {
    const session = new ProjectSession(new ControllablePersistenceAdapter());
    const before = session.getSnapshot().store;

    session.reloadStore();

    assert.equal(session.getSnapshot().status, "idle");
    assert.notEqual(session.getSnapshot().store, before);
  });
});

describe("project session operations during a module load", () => {
  async function loadingModule(): Promise<{
    adapter: ControllablePersistenceAdapter;
    session: ProjectSession;
  }> {
    const adapter = new ControllablePersistenceAdapter();
    await seedProject(
      adapter,
      "project-1",
      projectPayload(
        projectRegistry(
          [
            moduleEntry("module-a", "Alpha", snapshotWith("Alpha")),
            moduleEntry("module-b", "Beta", snapshotWith("Beta")),
          ],
          "module-a",
        ),
      ),
    );
    await seedTimeline(adapter, "project-1", "module-b", "Stale beta history");
    const session = new ProjectSession(adapter);
    await session.selectProject("project-1", "Project");
    adapter.hold("timeline-load:project-1::module-b");
    assert.equal(session.switchModule("module-b"), true);
    return { adapter, session };
  }

  it("does not attach a stale module timeline after adding a module", async () => {
    const { adapter, session } = await loadingModule();
    session.addModule("Gamma");
    const gammaId = session.getSnapshot().registry!.activeModuleId;

    adapter.release("timeline-load:project-1::module-b");
    await waitForModuleTimeline(adapter, "project-1", "module-b");

    assert.ok(!timelineContains(getTimelineSnapshot(), "Stale beta history"));
    session.getSnapshot().store.setPurpose({ purpose: "Gamma history" });
    session.flush();
    assert.equal(timelineWritesFor(adapter, "project-1", "module-b").length, 0);
    assert.ok(
      timelineContains(
        timelineWritesFor(adapter, "project-1", gammaId).at(-1)!
          .data as Record<string, unknown>,
        "Gamma history",
      ),
    );
    session.dispose();
  });

  it("does not attach a stale module timeline after an import", async () => {
    const { adapter, session } = await loadingModule();
    await session.importProjectFile(importedProject());

    adapter.release("timeline-load:project-1::module-b");
    await waitForModuleTimeline(adapter, "project-1", "module-b");

    assert.equal(session.getSnapshot().registry?.activeModuleId, "module-imported");
    assert.ok(!timelineContains(getTimelineSnapshot(), "Stale beta history"));
    session.getSnapshot().store.setPurpose({ purpose: "Imported history" });
    session.flush();
    assert.equal(timelineWritesFor(adapter, "project-1", "module-b").length, 0);
    session.dispose();
  });

  it("resumes the module load after a failed import", async () => {
    const { adapter, session } = await loadingModule();
    // Let the switch's own project write land before queueing the failure.
    await adapter.projects.load("project-1");
    adapter.failNext("project-write");
    await assert.rejects(
      session.importProjectFile(importedProject()),
      /Could not save the project/,
    );

    adapter.release("timeline-load:project-1::module-b");
    await waitForModuleTimeline(adapter, "project-1", "module-b", 2);

    assert.equal(session.getSnapshot().registry?.activeModuleId, "module-b");
    assert.ok(timelineContains(getTimelineSnapshot(), "Stale beta history"));
    session.dispose();
  });
});

describe("project session dropped loads", () => {
  it("drops a project load that finishes after dispose without a restart", async () => {
    const adapter = new ControllablePersistenceAdapter();
    await seedProject(
      adapter,
      "project-1",
      projectPayload(
        projectRegistry([moduleEntry("module-a", "Alpha")], "module-a"),
      ),
    );
    adapter.hold("project-load:project-1");
    const session = new ProjectSession(adapter);
    const opened = session.selectProject("project-1", "Project");

    session.dispose();
    adapter.release("project-load:project-1");
    await opened;

    assert.equal(session.getSnapshot().status, "loading");
    assert.equal(session.getSnapshot().registry, null);
    assert.equal(adapter.projectWrites.length, 0);
  });

  it("ignores a superseded project load that rejects", async () => {
    const adapter = new ControllablePersistenceAdapter();
    await seedProject(
      adapter,
      "project-1",
      projectPayload(
        projectRegistry([moduleEntry("module-a", "Alpha")], "module-a"),
      ),
    );
    await seedProject(
      adapter,
      "project-2",
      projectPayload(
        projectRegistry([moduleEntry("module-b", "Beta")], "module-b"),
      ),
      "Other",
    );
    adapter.hold("project-load:project-1");
    const session = new ProjectSession(adapter);
    const first = session.selectProject("project-1", "Project");
    await session.selectProject("project-2", "Other");

    adapter.release("project-load:project-1", new Error("Late failure."));
    await first;

    assert.equal(session.getSnapshot().status, "ready");
    assert.equal(session.getSnapshot().activeProject?.id, "project-2");
    session.dispose();
  });

  it("does not load the timeline of a superseded project", async () => {
    const adapter = new ControllablePersistenceAdapter();
    await seedProject(
      adapter,
      "project-1",
      projectPayload(
        projectRegistry([moduleEntry("module-a", "Alpha")], "module-a"),
      ),
    );
    adapter.hold("project-load:project-1");
    const session = new ProjectSession(adapter);
    const first = session.selectProject("project-1", "Project");
    session.backToProjects();

    adapter.release("project-load:project-1");
    await first;

    assert.equal(
      adapter.timelineLoads.filter((load) => load.projectId === "project-1")
        .length,
      0,
    );
  });

  it("ignores a superseded module timeline load that rejects", async () => {
    const adapter = new ControllablePersistenceAdapter();
    await seedProject(
      adapter,
      "project-1",
      projectPayload(
        projectRegistry(
          [
            moduleEntry("module-a", "Alpha"),
            moduleEntry("module-b", "Beta"),
            moduleEntry("module-c", "Gamma"),
          ],
          "module-a",
        ),
      ),
    );
    await seedTimeline(adapter, "project-1", "module-c", "Gamma history");
    const session = new ProjectSession(adapter);
    await session.selectProject("project-1", "Project");
    adapter.hold("timeline-load:project-1::module-b");
    assert.equal(session.switchModule("module-b"), true);
    assert.equal(session.switchModule("module-c"), true);
    await waitForModuleTimeline(adapter, "project-1", "module-c");

    adapter.release(
      "timeline-load:project-1::module-b",
      new Error("Late failure."),
    );
    await delay(0);

    // module-c's timeline stays attached and keeps saving.
    assert.ok(timelineContains(getTimelineSnapshot(), "Gamma history"));
    session.getSnapshot().store.setPurpose({ purpose: "Gamma after" });
    session.flush();
    assert.ok(
      timelineContains(
        timelineWritesFor(adapter, "project-1", "module-c").at(-1)!
          .data as Record<string, unknown>,
        "Gamma after",
      ),
    );
    session.dispose();
  });
});

describe("project session timeline attachment", () => {
  async function twoModuleProject(): Promise<{
    adapter: ControllablePersistenceAdapter;
    session: ProjectSession;
  }> {
    const adapter = new ControllablePersistenceAdapter();
    await seedProject(
      adapter,
      "project-1",
      projectPayload(
        projectRegistry(
          [
            moduleEntry("module-a", "Alpha", snapshotWith("Alpha")),
            moduleEntry("module-b", "Beta", snapshotWith("Beta")),
          ],
          "module-a",
        ),
      ),
    );
    await seedTimeline(adapter, "project-1", "module-a", "Alpha history");
    const session = new ProjectSession(adapter);
    await session.selectProject("project-1", "Project");
    return { adapter, session };
  }

  it("shows no history while the target module's timeline loads", async () => {
    const { adapter, session } = await twoModuleProject();
    const alphaStore = session.getSnapshot().store;
    assert.ok(timelineContains(getTimelineSnapshot(), "Alpha history"));
    adapter.hold("timeline-load:project-1::module-b");

    assert.equal(session.switchModule("module-b"), true);

    // Undo and the history view must not act on the hidden module-a store.
    assert.equal(getTimelineSnapshot(), null);
    alphaStore.setPurpose({ purpose: "Hidden edit" });
    session.flush();
    assert.equal(timelineWritesFor(adapter, "project-1", "module-a").length, 1);
    adapter.release("timeline-load:project-1::module-b");
    await waitForModuleTimeline(adapter, "project-1", "module-b");
    session.dispose();
  });

  it("stops recording the old store after returning to the project list", async () => {
    const { adapter, session } = await twoModuleProject();
    const alphaStore = session.getSnapshot().store;
    session.backToProjects();
    const writes = timelineWritesFor(adapter, "project-1", "module-a").length;

    alphaStore.setPurpose({ purpose: "After leaving" });
    session.flush();

    assert.equal(getTimelineSnapshot(), null);
    assert.equal(timelineWritesFor(adapter, "project-1", "module-a").length, writes);
  });
});

describe("project session stale results that need history to show", () => {
  async function threeModuleProject(): Promise<{
    adapter: ControllablePersistenceAdapter;
    session: ProjectSession;
  }> {
    const adapter = new ControllablePersistenceAdapter();
    await seedProject(
      adapter,
      "project-1",
      projectPayload(
        projectRegistry(
          [
            moduleEntry("module-a", "Alpha", snapshotWith("Alpha")),
            moduleEntry("module-b", "Beta", snapshotWith("Beta")),
            moduleEntry("module-c", "Gamma", snapshotWith("Gamma")),
          ],
          "module-a",
        ),
      ),
    );
    await seedTimeline(adapter, "project-1", "module-b", "Beta history");
    await seedTimeline(adapter, "project-1", "module-c", "Gamma history");
    const session = new ProjectSession(adapter);
    await session.selectProject("project-1", "Project");
    return { adapter, session };
  }

  it("never shows a stale module's history on the module switched to last", async () => {
    const { adapter, session } = await threeModuleProject();
    adapter.hold("timeline-load:project-1::module-b");
    adapter.hold("timeline-load:project-1::module-c");
    assert.equal(session.switchModule("module-b"), true);
    assert.equal(session.switchModule("module-c"), true);

    adapter.release("timeline-load:project-1::module-b");
    await waitForModuleTimeline(adapter, "project-1", "module-b");
    adapter.release("timeline-load:project-1::module-c");
    await waitForModuleTimeline(adapter, "project-1", "module-c");

    const shown = getTimelineSnapshot();
    assert.ok(timelineContains(shown, "Gamma history"));
    assert.ok(!timelineContains(shown, "Beta history"));
    session.dispose();
  });

  it("resumes the last module's load after a stale load failed and the session restarted", async () => {
    const { adapter, session } = await threeModuleProject();
    adapter.hold("timeline-load:project-1::module-b");
    adapter.hold("timeline-load:project-1::module-c");
    assert.equal(session.switchModule("module-b"), true);
    assert.equal(session.switchModule("module-c"), true);
    adapter.release("timeline-load:project-1::module-b", new Error("Stale."));
    await delay(0);

    session.dispose();
    session.start();
    adapter.release("timeline-load:project-1::module-c");
    await waitForModuleTimeline(adapter, "project-1", "module-c", 2);

    assert.ok(timelineContains(getTimelineSnapshot(), "Gamma history"));
    session.dispose();
  });

  it("keeps refusing changes while an import write runs, even if a module load lands", async () => {
    const { adapter, session } = await threeModuleProject();
    adapter.hold("timeline-load:project-1::module-b");
    assert.equal(session.switchModule("module-b"), true);
    await adapter.projects.load("project-1");
    adapter.hold("project-save:project-1");
    const importing = session.importProjectFile(importedProject());

    adapter.release("timeline-load:project-1::module-b");
    await waitForModuleTimeline(adapter, "project-1", "module-b");
    assert.equal(session.switchModule("module-c"), false);
    assert.equal(getTimelineSnapshot(), null);

    adapter.release("project-save:project-1");
    await importing;
    assert.equal(session.getSnapshot().registry?.activeModuleId, "module-imported");
    session.dispose();
  });

  it("stops recording the old store while another project loads", async () => {
    const { adapter, session } = await threeModuleProject();
    const alphaStore = session.getSnapshot().store;
    adapter.hold("project-load:project-2");
    const opening = session.selectProject("project-2", "Other");
    const writes = timelineWritesFor(adapter, "project-1", "module-a").length;

    alphaStore.setPurpose({ purpose: "While another project loads" });
    session.flush();

    assert.equal(getTimelineSnapshot(), null);
    assert.equal(timelineWritesFor(adapter, "project-1", "module-a").length, writes);
    adapter.release("project-load:project-2");
    await opening;
    session.dispose();
  });

  it("rejects with the write error when a stale import fails while another project loads", async () => {
    const { adapter, session } = await threeModuleProject();
    await adapter.projects.load("project-1");
    adapter.hold("project-save:project-1");
    const importing = session.importProjectFile(importedProject());
    adapter.hold("project-load:project-2");
    const opening = session.selectProject("project-2", "Other");

    adapter.release("project-save:project-1", new Error("Import write failed."));
    await assert.rejects(importing, /Import write failed/);
    assert.equal(session.getSnapshot().status, "loading");
    assert.equal(session.getSnapshot().activeProject?.id, "project-2");

    adapter.release("project-load:project-2");
    await opening;
    session.dispose();
  });
});

describe("project session write results out of order", () => {
  it("keeps a newer failure when an older write succeeds after it", async () => {
    const adapter = new ManualProjectWriteAdapter();
    await adapter.inner.projects.saveIndex([
      projectMeta("project-1", "Project"),
    ]);
    const session = new ProjectSession(adapter);
    await session.selectProject("project-1", "Project");
    await adapter.settle(0);

    session.getSnapshot().store.setPurpose({ purpose: "First write" });
    session.flush();
    session.getSnapshot().store.setPurpose({ purpose: "Second write" });
    session.flush();
    assert.equal(adapter.pending.length, 2);

    await adapter.settle(1, new Error("Could not save the project."));
    await delay(0);
    assert.notEqual(session.getSnapshot().persistenceError, null);

    await adapter.settle(0);
    await delay(0);
    assert.notEqual(
      session.getSnapshot().persistenceError,
      null,
      "the older success must not clear the newer failure",
    );
    session.dispose();
  });
});

describe("project session final review cases", () => {
  async function openProject(): Promise<{
    adapter: ControllablePersistenceAdapter;
    session: ProjectSession;
  }> {
    const adapter = new ControllablePersistenceAdapter();
    await seedProject(
      adapter,
      "project-1",
      projectPayload(
        projectRegistry(
          [moduleEntry("module-a", "Alpha", snapshotWith("Alpha"))],
          "module-a",
        ),
      ),
    );
    const session = new ProjectSession(adapter);
    await session.selectProject("project-1", "Project");
    await adapter.projects.load("project-1");
    return { adapter, session };
  }

  it("reopens the imported project when restarted after a dispose during the import", async () => {
    const { adapter, session } = await openProject();
    adapter.hold("project-save:project-1");
    const importing = session.importProjectFile(importedProject());

    session.dispose();
    session.start();
    adapter.release("project-save:project-1");
    await importing;
    await waitFor(
      "the reopened project",
      () =>
        session.getSnapshot().registry?.activeModuleId === "module-imported",
    );

    assert.equal(session.getSnapshot().status, "ready");
    assert.equal(labelOf(session.getSnapshot().store), "Imported");
    session.dispose();
  });

  it("keeps the shown store while importing, even when asked to reload it", async () => {
    const { adapter, session } = await openProject();
    adapter.hold("project-save:project-1");
    adapter.failNext("project-write");
    const shown = session.getSnapshot().store;
    const importing = session.importProjectFile(importedProject());

    session.reloadStore();
    assert.equal(session.getSnapshot().store, shown);
    adapter.release("project-save:project-1");
    await assert.rejects(importing, /Could not save the project/);

    shown.setPurpose({ purpose: "Recorded after the failed import" });
    assert.ok(
      timelineContains(getTimelineSnapshot(), "Recorded after the failed import"),
    );
    session.dispose();
  });

  it("writes edits made during a failed import", async () => {
    const { adapter, session } = await openProject();
    adapter.hold("project-save:project-1");
    adapter.failNext("project-write");
    const importing = session.importProjectFile(importedProject());

    session.getSnapshot().store.setPurpose({ purpose: "Edited during import" });
    adapter.release("project-save:project-1");
    await assert.rejects(importing, /Could not save the project/);
    await adapter.projects.load("project-1");

    assert.equal(
      overviewOf(await storedProject(adapter, "project-1")).purpose,
      "Edited during import",
    );
    session.dispose();
  });
});

describe("project session AI provider activity", () => {
  const call = (id: string, startedAt: string) => ({
    id,
    operation: id,
    attempt: 1,
    promptVersion: "v",
    protocolVersion: 6,
    startedAt,
    durationMs: 1,
    provider: "provider",
    model: "model",
    outcome: "success" as const,
    toolCallCount: 0,
  });
  const recorded = (startedAt: string) => {
    const { id: _id, ...metadata } = call("recorded", startedAt);
    return { ...metadata, promptVersion: PROMPT_VERSION, protocolVersion: HARNESS_PROTOCOL_VERSION };
  };

  it("keeps the shown module's calls in storage with no page involved", async () => {
    const adapter = new ControllablePersistenceAdapter();
    await seedProject(
      adapter,
      "project-1",
      projectPayload(
        projectRegistry(
          [moduleEntry("module-a", "Alpha"), moduleEntry("module-b", "Beta")],
          "module-a",
        ),
      ),
    );
    await adapter.providerCalls.replace("project-1", "module-a", [
      call("stored", "2026-10-24T09:00:00.000Z"),
    ]);
    const session = new ProjectSession(adapter);
    await session.selectProject("project-1", "Project");
    await delay(0);

    const store = session.getSnapshot().store;
    assert.deepEqual(store.providerCalls.map(({ id }) => id), ["stored"]);
    store.recordProviderCalls([recorded("2026-10-24T10:00:00.000Z")]);
    await delay(0);
    assert.equal((await adapter.providerCalls.load("project-1", "module-a")).length, 2);

    assert.equal(session.switchModule("module-b"), true);
    await delay(0);
    session.getSnapshot().store.recordProviderCalls([recorded("2026-10-24T11:00:00.000Z")]);
    await delay(0);
    assert.equal((await adapter.providerCalls.load("project-1", "module-a")).length, 2);
    assert.equal((await adapter.providerCalls.load("project-1", "module-b")).length, 1);
    session.dispose();
  });

  it("reports a failed save in the persistence banner until a save succeeds", async () => {
    const adapter = new ControllablePersistenceAdapter();
    await seedProject(
      adapter,
      "project-1",
      projectPayload(projectRegistry([moduleEntry("module-a", "Alpha")], "module-a")),
    );
    adapter.inner.failNext("provider-call-write");
    const session = new ProjectSession(adapter);
    await session.selectProject("project-1", "Project");
    await delay(0);
    assert.match(session.getSnapshot().persistenceError ?? "", /AI provider activity could not be saved/);

    session.getSnapshot().store.recordProviderCalls([recorded("2026-10-24T10:00:00.000Z")]);
    await delay(0);
    assert.equal(session.getSnapshot().persistenceError, null);
    session.dispose();
  });
});

describe("project session persistence messages", () => {
  it("keeps each source's message until that source succeeds", async () => {
    const adapter = new ControllablePersistenceAdapter();
    adapter.inner.failNext("provider-call-write");
    const session = new ProjectSession(adapter);
    await session.selectProject("project-1", "Project");
    await adapter.projects.load("project-1");
    await delay(0);
    adapter.failNext("project-write");
    session.getSnapshot().store.setPurpose({ purpose: "Fails" });
    session.flush();
    await waitFor("the failed save", () => /^Changes could not be saved/.test(session.getSnapshot().persistenceError ?? ""));
    assert.match(session.getSnapshot().persistenceError ?? "", /AI provider activity could not be saved/);

    // The next activity save succeeds and clears only its own message.
    session.getSnapshot().store.clearProviderCalls();
    await delay(0);
    assert.match(session.getSnapshot().persistenceError ?? "", /^Changes could not be saved/);
    assert.doesNotMatch(session.getSnapshot().persistenceError ?? "", /AI provider activity/);
    session.dispose();
  });
});

describe("project session in a single-project storage", () => {
  class SingleProjectAdapter extends MemoryPersistenceAdapter {
    override readonly traits = { singleProject: true, name: "requireganizer.json" };
  }

  it("opens the only project when it starts, and stays idle while there is none", async () => {
    const empty = new ProjectSession(new SingleProjectAdapter());
    empty.start();
    await empty.openOnlyProject();
    assert.equal(empty.getSnapshot().status, "idle");

    const adapter = new SingleProjectAdapter();
    await adapter.projects.saveIndex([projectMeta("project-1", "Project")]);
    await adapter.projects.save(
      "project-1",
      projectPayload(projectRegistry([moduleEntry("module-a", "Alpha")], "module-a")),
    );
    const session = new ProjectSession(adapter);
    session.start();
    // A caller that asks meanwhile waits for the same load.
    await session.openOnlyProject();
    const snapshot = session.getSnapshot();
    assert.equal(snapshot.status, "ready");
    assert.equal(snapshot.activeProject?.id, "project-1");
    session.dispose();
  });
});
