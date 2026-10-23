import type {
  PersistenceAdapter,
  ProjectDeleteAuxiliary,
  ProjectPersistence,
  ProviderCallPersistence,
  RevisionPersistence,
  TimelinePersistence,
} from "./adapter";
import {
  deleteProjectData,
  getProjectsIndex,
  loadProjectData,
  loadTimelineData,
  saveProjectBundle,
  saveProjectData,
  saveProjectsIndex,
  saveTimelineData,
} from "../lib/projectStorage";
import {
  deleteProviderCallsForProject,
  loadProviderCalls,
  replaceProviderCalls,
} from "../lib/providerCallStorage";
import {
  deleteProjectSnapshot,
  deleteProjectSnapshots,
  listProjectSnapshots,
  saveProjectSnapshot,
  setSnapshotPinned,
} from "../lib/revisionStorage";

/**
 * A `PersistenceAdapter` over the browser storage the application already
 * uses: localStorage for the projects index, project payloads and module
 * timelines, and IndexedDB for revision snapshots and provider-call logs.
 *
 * Each member delegates to the corresponding `app/lib` function, so the
 * synchronous throws of those functions surface as rejected promises.
 */
export class WebPersistenceAdapter implements PersistenceAdapter {
  readonly projects: ProjectPersistence = {
    list: async () => getProjectsIndex(),
    saveIndex: async (projects) => {
      saveProjectsIndex(projects);
    },
    load: async (projectId) => loadProjectData(projectId),
    save: async (projectId, data) => {
      saveProjectData(projectId, data);
    },
    saveBundle: async (projectId, data, projects) => {
      saveProjectBundle(projectId, data, projects);
    },
    delete: async (projectId) => {
      // Rejects only when the project itself could not be removed.
      deleteProjectData(projectId);

      const unremoved: ProjectDeleteAuxiliary[] = [];
      try {
        await deleteProjectSnapshots(projectId);
      } catch (error) {
        console.error("Could not delete project revision snapshots.", error);
        unremoved.push("revisions");
      }
      try {
        await deleteProviderCallsForProject(projectId);
      } catch (error) {
        console.error("Could not delete the project's provider activity.", error);
        unremoved.push("providerCalls");
      }
      return { unremoved };
    },
  };

  readonly timelines: TimelinePersistence = {
    /**
     * `loadTimelineData` also reads the pre-module key for the legacy module,
     * migrating timelines written before module scoping on first read.
     */
    load: async (projectId, moduleId) =>
      loadTimelineData(projectId, moduleId),
    save: async (projectId, moduleId, data) =>
      saveTimelineData(projectId, moduleId, data),
  };

  readonly revisions: RevisionPersistence = {
    list: async (projectId, moduleId) =>
      listProjectSnapshots(projectId, moduleId),
    save: async (projectId, moduleId, data, label, pinned) =>
      saveProjectSnapshot(projectId, moduleId, data, label, pinned),
    setPinned: async (snapshotId, pinned) => {
      await setSnapshotPinned(snapshotId, pinned);
    },
    delete: async (snapshotId) => {
      await deleteProjectSnapshot(snapshotId);
    },
  };

  readonly providerCalls: ProviderCallPersistence = {
    load: async (projectId, moduleId) =>
      loadProviderCalls(projectId, moduleId),
    replace: async (projectId, moduleId, calls) => {
      await replaceProviderCalls(projectId, moduleId, calls);
    },
  };
}

/** The application's browser-storage adapter. */
export const webPersistence = new WebPersistenceAdapter();
