import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getSnapshot } from "mobx-state-tree";

import {
  LEGACY_MODULE_ID,
  type ModuleEntry,
  type ModuleRegistry,
  type ProjectPayload,
  visibleModules,
} from "../app/lib/moduleSchema";
import { PROJECT_SCHEMA_VERSION } from "../app/lib/projectSchema";
import type { ProjectMeta } from "../app/lib/projectStorage";
import {
  PROJECT_SAVE_DEBOUNCE_MS,
  ProjectSession,
  type ProjectSessionStorage,
} from "../app/project-session";
import { WorkflowStage } from "../app/store/constants";
import { Store } from "../app/store/store";

class MemoryProjectSessionStorage implements ProjectSessionStorage {
  readonly projects = new Map<string, unknown>();
  readonly timelines = new Map<string, Record<string, unknown>>();
  readonly projectSaves: Array<{ id: string; data: unknown }> = [];
  index: ProjectMeta[] = [];
  failSaves = false;

  loadProjectData(id: string): Record<string, unknown> | null {
    return (this.projects.get(id) as Record<string, unknown> | undefined) ?? null;
  }

  saveProjectData(id: string, data: unknown): void {
    if (this.failSaves) throw new Error(`Could not write ${id}.`);
    this.projectSaves.push({ id, data });
    this.projects.set(id, data);
  }

  getProjectsIndex(): ProjectMeta[] {
    return this.index;
  }

  saveProjectsIndex(projects: ProjectMeta[]): void {
    this.index = projects;
  }

  loadTimelineData(
    projectId: string,
    moduleId: string,
  ): Record<string, unknown> | null {
    return this.timelines.get(`${projectId}::${moduleId}`) ?? null;
  }

  saveTimelineData(
    projectId: string,
    moduleId: string,
    data: unknown,
  ): boolean {
    this.timelines.set(
      `${projectId}::${moduleId}`,
      data as Record<string, unknown>,
    );
    return true;
  }
}

function snapshotWith(name: string, purpose = ""): Record<string, unknown> {
  const store = Store.create({ productOverview: {} });
  store.setName({ name });
  if (purpose.length > 0) store.setPurpose({ purpose });
  return getSnapshot(store) as unknown as Record<string, unknown>;
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

function storedProject(
  storage: MemoryProjectSessionStorage,
  id: string,
): ProjectPayload {
  const data = storage.loadProjectData(id);
  assert.ok(data != null);
  return data as unknown as ProjectPayload;
}

describe("project session loading", () => {
  it("opens the active module of a valid stored project", () => {
    const storage = new MemoryProjectSessionStorage();
    storage.index = [projectMeta("project-1", "Project")];
    storage.projects.set(
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

    const session = new ProjectSession(storage);
    session.selectProject("project-1", "Project");

    const state = session.getSnapshot();
    assert.deepEqual(state.activeProject, { id: "project-1", name: "Project" });
    assert.equal(state.registry?.activeModuleId, "module-b");
    assert.equal(state.store.productOverview.name, "Billing");
    assert.equal(state.persistenceError, null);
  });

  it("opens a blank project when stored data is invalid", () => {
    const storage = new MemoryProjectSessionStorage();
    storage.projects.set("project-1", { schemaVersion: 999 });

    const session = new ProjectSession(storage);
    session.selectProject("project-1", "Project");

    const state = session.getSnapshot();
    assert.deepEqual(state.activeProject, { id: "project-1", name: "Project" });
    assert.equal(state.registry?.activeModuleId, LEGACY_MODULE_ID);
    assert.equal(state.store.productOverview.name, null);
    assert.equal(visibleModules(state.registry!).length, 1);
  });

  it("opens a blank project when a stored module snapshot is invalid", () => {
    const storage = new MemoryProjectSessionStorage();
    storage.projects.set(
      "project-1",
      projectPayload(
        projectRegistry(
          [
            moduleEntry("module-a", "Alpha", {
              ...snapshotWith("Alpha"),
              productOverview: "not an object",
            }),
          ],
          "module-a",
        ),
      ),
    );

    const session = new ProjectSession(storage);
    session.selectProject("project-1", "Project");

    const state = session.getSnapshot();
    assert.equal(state.registry?.activeModuleId, LEGACY_MODULE_ID);
    assert.equal(state.store.productOverview.name, null);
    assert.equal(storedProject(storage, "project-1").activeModuleId, LEGACY_MODULE_ID);
    session.dispose();
  });

  it("creates the legacy module for a project with no stored data", () => {
    const storage = new MemoryProjectSessionStorage();
    const session = new ProjectSession(storage);

    session.selectProject("project-missing", "Missing");

    const state = session.getSnapshot();
    assert.equal(state.activeProject?.id, "project-missing");
    assert.equal(state.registry?.activeModuleId, LEGACY_MODULE_ID);
    assert.equal(state.registry?.modulesEnabled, false);
    assert.equal(storedProject(storage, "project-missing").activeModuleId, LEGACY_MODULE_ID);
  });

  it("reports the persistence error when a save fails", () => {
    const storage = new MemoryProjectSessionStorage();
    storage.failSaves = true;
    const session = new ProjectSession(storage);

    session.selectProject("project-1", "Project");

    assert.equal(
      session.getSnapshot().persistenceError,
      "Changes could not be saved in browser storage. Export the project to avoid losing work.",
    );
  });
});

describe("project session saving", () => {
  it("coalesces snapshot changes and flushes the latest write", async () => {
    const storage = new MemoryProjectSessionStorage();
    storage.projects.set(
      "project-1",
      projectPayload(
        projectRegistry([moduleEntry("module-a", "Alpha")], "module-a"),
      ),
    );
    const session = new ProjectSession(storage);
    session.selectProject("project-1", "Project");
    storage.projectSaves.length = 0;

    const store = session.getSnapshot().store;
    store.setName({ name: "First name" });
    store.setPurpose({ purpose: "Final purpose" });
    assert.equal(storage.projectSaves.length, 0);

    await delay(PROJECT_SAVE_DEBOUNCE_MS + 100);

    assert.equal(storage.projectSaves.length, 1);
    const saved = overviewOf(storage.projectSaves[0].data);
    assert.equal(saved.name, "First name");
    assert.equal(saved.purpose, "Final purpose");

    store.setName({ name: "Second name" });
    assert.equal(storage.projectSaves.length, 1);
    session.flush();
    assert.equal(storage.projectSaves.length, 2);
    assert.equal(overviewOf(storage.projectSaves[1].data).name, "Second name");

    await delay(PROJECT_SAVE_DEBOUNCE_MS + 100);
    assert.equal(storage.projectSaves.length, 2);
  });

  it("flushes the outgoing module before switching", () => {
    const storage = new MemoryProjectSessionStorage();
    storage.projects.set(
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
    const session = new ProjectSession(storage);
    session.selectProject("project-1", "Project");
    storage.projectSaves.length = 0;

    session.getSnapshot().store.setName({ name: "Alpha changed" });
    assert.equal(session.switchModule("module-b"), true);

    assert.ok(storage.projectSaves.length >= 2);
    const flushed = storage.projectSaves[0].data as ProjectPayload;
    assert.equal(flushed.activeModuleId, "module-a");
    assert.equal(overviewOf(flushed).name, "Alpha changed");

    const switched = storage.projectSaves[1].data as ProjectPayload;
    assert.equal(switched.activeModuleId, "module-b");
    assert.equal(session.getSnapshot().store.productOverview.name, "Beta");
  });

  it("flushes the active module before adding a module", () => {
    const storage = new MemoryProjectSessionStorage();
    storage.projects.set(
      "project-1",
      projectPayload(
        projectRegistry([moduleEntry("module-a", "Alpha", snapshotWith("Alpha"))], "module-a"),
      ),
    );
    const session = new ProjectSession(storage);
    session.selectProject("project-1", "Project");
    storage.projectSaves.length = 0;

    session.getSnapshot().store.setName({ name: "Alpha changed" });
    session.addModule("Gamma");

    assert.ok(storage.projectSaves.length >= 2);
    const flushed = storage.projectSaves[0].data as ProjectPayload;
    assert.equal(flushed.activeModuleId, "module-a");
    assert.equal(overviewOf(flushed).name, "Alpha changed");
    const added = session.getSnapshot().registry;
    assert.equal(added?.modules.length, 2);
    assert.equal(
      added?.modules.find((entry) => entry.id === added.activeModuleId)?.name,
      "Gamma",
    );
  });

  it("flushes the outgoing project before importing", () => {
    const storage = new MemoryProjectSessionStorage();
    storage.projects.set(
      "project-1",
      projectPayload(
        projectRegistry([moduleEntry("module-a", "Alpha", snapshotWith("Alpha"))], "module-a"),
      ),
    );
    const session = new ProjectSession(storage);
    session.selectProject("project-1", "Project");
    storage.projectSaves.length = 0;

    session.getSnapshot().store.setName({ name: "Alpha changed" });
    const imported = projectPayload(
      projectRegistry(
        [moduleEntry("module-imported", "Imported", snapshotWith("Imported"))],
        "module-imported",
        false,
      ),
    );
    session.importProjectFile(imported);

    assert.equal(storage.projectSaves.length, 3);
    const flushed = storage.projectSaves[0].data as ProjectPayload;
    assert.equal(flushed.activeModuleId, "module-a");
    assert.equal(overviewOf(flushed).name, "Alpha changed");

    const importedSave = storage.projectSaves[1].data as ProjectPayload;
    assert.equal(importedSave.activeModuleId, "module-imported");
    assert.equal(importedSave.modules.length, 1);
    assert.equal(importedSave.modules[0].name, "Imported");
    assert.equal(
      (importedSave.modules[0].snapshot.productOverview as Record<string, unknown>)
        .name,
      "Imported",
    );

    const reopenedSave = storage.projectSaves[2].data as ProjectPayload;
    assert.equal(reopenedSave.activeModuleId, "module-imported");
    assert.equal(session.getSnapshot().registry?.activeModuleId, "module-imported");
    assert.equal(session.getSnapshot().store.productOverview.name, "Imported");
    session.dispose();
  });

  it("does not persist a late mutation on the old store after a module switch", () => {
    const storage = new MemoryProjectSessionStorage();
    storage.projects.set(
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
    const session = new ProjectSession(storage);
    session.selectProject("project-1", "Project");
    const oldStore = session.getSnapshot().store;

    oldStore.setName({ name: "Alpha changed" });
    assert.equal(session.switchModule("module-b"), true);

    const switched = storedProject(storage, "project-1");
    assert.equal(switched.activeModuleId, "module-b");
    const alpha = switched.modules.find((entry) => entry.id === "module-a");
    assert.equal(
      (alpha?.snapshot.productOverview as Record<string, unknown>).name,
      "Alpha changed",
    );
    const beta = switched.modules.find((entry) => entry.id === "module-b");
    assert.equal(
      (beta?.snapshot.productOverview as Record<string, unknown>).name,
      "Beta",
    );

    const savesAfterSwitch = storage.projectSaves.length;
    oldStore.setName({ name: "Late old-store change" });
    session.flush();
    assert.equal(storage.projectSaves.length, savesAfterSwitch);

    const persisted = storedProject(storage, "project-1");
    assert.equal(persisted.activeModuleId, "module-b");
    const persistedBeta = persisted.modules.find(
      (entry) => entry.id === "module-b",
    );
    assert.equal(
      (persistedBeta?.snapshot.productOverview as Record<string, unknown>).name,
      "Beta",
    );
    session.dispose();
  });

  it("wires timeline persistence to the active module", () => {
    const storage = new MemoryProjectSessionStorage();
    storage.projects.set(
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
    const session = new ProjectSession(storage);
    session.selectProject("project-1", "Project");

    const alphaKey = "project-1::module-a";
    session.getSnapshot().store.setName({ name: "Alpha edit" });
    session.flush();
    const alphaTimeline = storage.timelines.get(alphaKey);
    assert.ok(alphaTimeline != null);
    assert.match(
      (alphaTimeline.artifacts as Array<[string, string]>)
        .map(([, json]) => json)
        .join("\n"),
      /Alpha edit/,
    );

    assert.equal(session.switchModule("module-b"), true);
    const betaKey = "project-1::module-b";
    session.getSnapshot().store.setName({ name: "Beta edit" });
    session.flush();
    const betaTimeline = storage.timelines.get(betaKey);
    assert.ok(betaTimeline != null);
    assert.match(
      (betaTimeline.artifacts as Array<[string, string]>)
        .map(([, json]) => json)
        .join("\n"),
      /Beta edit/,
    );

    session.backToProjects();
    assert.ok(storage.timelines.has(alphaKey));
    assert.ok(storage.timelines.has(betaKey));
    session.dispose();
  });

  it("leaves storage untouched when an import fails validation", () => {
    const storage = new MemoryProjectSessionStorage();
    storage.projects.set(
      "project-1",
      projectPayload(
        projectRegistry([moduleEntry("module-a", "Alpha", snapshotWith("Alpha"))], "module-a"),
      ),
    );
    const session = new ProjectSession(storage);
    session.selectProject("project-1", "Project");
    const before = storage.loadProjectData("project-1");
    storage.projectSaves.length = 0;

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

    assert.equal(storage.projectSaves.length, 0);
    assert.equal(storage.loadProjectData("project-1"), before);
    session.dispose();
  });
});

describe("project session lifecycle", () => {
  it("keeps snapshot identity stable and notifies subscribers", () => {
    const storage = new MemoryProjectSessionStorage();
    const session = new ProjectSession(storage);
    let notifications = 0;
    const unsubscribe = session.subscribe(() => {
      notifications += 1;
    });

    const initial = session.getSnapshot();
    assert.equal(session.getSnapshot(), initial);
    assert.equal(notifications, 0);

    session.selectProject("project-1", "Project");
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
    const storage = new MemoryProjectSessionStorage();
    storage.projects.set(
      "project-1",
      projectPayload(
        projectRegistry([moduleEntry("module-a", "Alpha", snapshotWith("Alpha"))], "module-a"),
      ),
    );
    const session = new ProjectSession(storage);
    session.selectProject("project-1", "Project");
    storage.projectSaves.length = 0;

    const store = session.getSnapshot().store;
    store.setName({ name: "Pending write" });
    assert.equal(storage.projectSaves.length, 0);

    session.dispose();
    assert.equal(storage.projectSaves.length, 1);
    assert.equal(overviewOf(storage.projectSaves[0].data).name, "Pending write");

    const timelineWrites = storage.timelines.size;
    await delay(PROJECT_SAVE_DEBOUNCE_MS + 100);
    assert.equal(storage.projectSaves.length, 1);
    assert.equal(storage.timelines.size, timelineWrites);

    session.dispose();
    assert.equal(storage.projectSaves.length, 1);

    store.setName({ name: "After dispose" });
    await delay(PROJECT_SAVE_DEBOUNCE_MS + 100);
    assert.equal(storage.projectSaves.length, 1);

    session.start();
    store.setName({ name: "After restart" });
    session.flush();
    assert.equal(storage.projectSaves.length, 2);
    assert.equal(overviewOf(storage.projectSaves[1].data).name, "After restart");
    session.dispose();
  });
});

describe("project session public API", () => {
  it("keeps methods callable when detached from the session", () => {
    const storage = new MemoryProjectSessionStorage();
    storage.projects.set(
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
    const session = new ProjectSession(storage);
    const {
      selectProject,
      switchModule,
      addModule,
      recordOpenStep,
      archiveModule,
      backToProjects,
    } = session;

    selectProject("project-1", "Project");
    assert.equal(session.getSnapshot().activeProject?.id, "project-1");
    assert.equal(session.getSnapshot().registry?.activeModuleId, "module-a");

    assert.equal(switchModule("module-b"), true);
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
        .registry?.modules.find((entry) => entry.id === "module-b")?.archivedAt != null,
    );

    backToProjects();
    assert.equal(session.getSnapshot().activeProject, null);
  });
});

describe("project session module registry", () => {
  it("rejects empty and duplicate names without writing", () => {
    const storage = new MemoryProjectSessionStorage();
    storage.projects.set(
      "project-1",
      projectPayload(
        projectRegistry([moduleEntry("module-a", "Alpha", snapshotWith("Alpha"))], "module-a", false),
      ),
    );
    const session = new ProjectSession(storage);
    session.selectProject("project-1", "Project");
    const before = storage.loadProjectData("project-1");
    storage.projectSaves.length = 0;

    assert.throws(() => session.enableModules("   "), /cannot be empty/);
    assert.throws(() => session.enableModules("alpha"), /already exists/);
    assert.throws(() => session.addModule(""), /cannot be empty/);
    assert.throws(() => session.addModule("ALPHA"), /already exists/);

    assert.equal(storage.projectSaves.length, 0);
    assert.equal(storage.loadProjectData("project-1"), before);
    session.dispose();
  });

  it("archives only a visible, non-active module", () => {
    const storage = new MemoryProjectSessionStorage();
    storage.projects.set(
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
    const session = new ProjectSession(storage);
    session.selectProject("project-1", "Project");

    session.archiveModule("module-a");
    assert.equal(
      session.getSnapshot().registry?.modules.find((entry) => entry.id === "module-a")
        ?.archivedAt,
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

  it("records open steps only while modules are enabled", () => {
    const storage = new MemoryProjectSessionStorage();
    const session = new ProjectSession(storage);
    session.selectProject("project-1", "Project");

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
});
