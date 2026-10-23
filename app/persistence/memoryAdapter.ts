import type {
  PersistenceAdapter,
  ProjectDeleteAuxiliary,
  ProjectPersistence,
  ProviderCallPersistence,
  RevisionPersistence,
  TimelinePersistence,
} from "./adapter";
import { moduleScopeId } from "../lib/moduleSchema";
import {
  getTimelineStorageKey,
  isProjectTimelineStorageKey,
  parseProjectsIndex,
  parseStoredProjectData,
  parseTimelineData,
  PROJECT_BUNDLE_SAVE_ERROR_MESSAGE,
  PROJECT_DELETE_ERROR_MESSAGE,
  PROJECT_INDEX_SAVE_ERROR_MESSAGE,
  PROJECT_SAVE_ERROR_MESSAGE,
  ProjectStorageError,
  removeProjectFromIndex,
  updateProjectIndexEntry,
  serializeProjectBundle,
} from "../lib/projectStorage";
import {
  compareProviderCallsOldestFirst,
  PROVIDER_CALL_LOAD_ERROR_MESSAGE,
  PROVIDER_CALL_SAVE_ERROR_MESSAGE,
  ProviderCallStorageError,
  type StoredProviderCall,
  toProviderCall,
  toStoredProviderCall,
} from "../lib/providerCallStorage";
import {
  createRevisionSnapshot,
  type ProjectRevisionSnapshot,
  REVISION_SNAPSHOT_LOAD_ERROR_MESSAGE,
  REVISION_SNAPSHOT_MISSING_MESSAGE,
  snapshotIdsToPrune,
  sortRevisionSnapshotsNewestFirst,
} from "../lib/revisionStorage";
import type { ProviderCallRecord } from "../lib/types";

/** Operations whose next invocation a test can make fail. */
export type MemoryPersistenceFailure =
  | "project-write"
  | "timeline-save"
  | "revision-read"
  | "revision-write"
  | "provider-call-read"
  | "provider-call-write";

export interface MemoryPersistenceAdapterOptions {
  /** Clock used for revision snapshot creation times. */
  now?: () => Date;
  /** Generator for revision snapshot ids. */
  createRevisionSnapshotId?: () => string;
}

/**
 * An in-memory `PersistenceAdapter` for tests and for steps that need a
 * storage without a browser. Values are copied on the way in and out, so it
 * has the same isolation as the web storage: JSON round trips for the
 * projects index, project payloads and timelines, and structured clones for
 * revision snapshots and provider calls.
 *
 * Failures can be queued with `failNext`; each queued failure applies to the
 * next call of its kind. A queued timeline save resolves `false`, like a full
 * storage; queued project, revision, and provider-call writes reject with the
 * same kind of error their web counterparts throw.
 */
export class MemoryPersistenceAdapter implements PersistenceAdapter {
  private projectsIndexSource: string | null = null;
  private readonly projectSources = new Map<string, string>();
  private readonly timelineSources = new Map<string, string>();
  private readonly revisionSnapshots = new Map<string, ProjectRevisionSnapshot>();
  private readonly providerCallsByProject = new Map<
    string,
    Map<string, StoredProviderCall>
  >();
  private readonly pendingFailures: MemoryPersistenceFailure[] = [];
  private readonly now: () => Date;
  private readonly createRevisionSnapshotId: () => string;

  constructor(options: MemoryPersistenceAdapterOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.createRevisionSnapshotId =
      options.createRevisionSnapshotId ?? (() => crypto.randomUUID());
  }

  readonly projects: ProjectPersistence = {
    list: async () => parseProjectsIndex(this.projectsIndexSource),
    saveIndex: async (projects) => {
      this.assertNoQueuedFailure(
        "project-write",
        PROJECT_INDEX_SAVE_ERROR_MESSAGE,
      );
      const source = this.serialize(
        projects,
        PROJECT_INDEX_SAVE_ERROR_MESSAGE,
      );
      if (source === undefined) {
        throw new ProjectStorageError(PROJECT_INDEX_SAVE_ERROR_MESSAGE);
      }
      this.projectsIndexSource = source;
    },
    load: async (projectId) => this.loadProjectData(projectId),
    save: async (projectId, data, indexUpdate) => {
      this.assertNoQueuedFailure("project-write", PROJECT_SAVE_ERROR_MESSAGE);
      const projectSource =
        this.serialize(data, PROJECT_SAVE_ERROR_MESSAGE) ?? "undefined";
      let updatedIndexSource: string | null = null;
      if (indexUpdate != null) {
        const projects = parseProjectsIndex(this.projectsIndexSource);
        const updatedProjects = updateProjectIndexEntry(
          projects,
          projectId,
          indexUpdate,
        );
        if (updatedProjects !== projects) {
          updatedIndexSource = this.serialize(
            updatedProjects,
            PROJECT_INDEX_SAVE_ERROR_MESSAGE,
          ) ?? null;
        }
      }
      this.projectSources.set(projectId, projectSource);
      if (updatedIndexSource != null) {
        this.projectsIndexSource = updatedIndexSource;
      }
    },
    saveBundle: async (projectId, data, projects) => {
      this.assertNoQueuedFailure(
        "project-write",
        PROJECT_BUNDLE_SAVE_ERROR_MESSAGE,
      );
      const { projectSource, indexSource } = serializeProjectBundle(
        data,
        projects,
      );
      // Both writes happen together, as the rollback in web storage ensures.
      this.projectSources.set(projectId, projectSource);
      this.projectsIndexSource = indexSource;
    },
    delete: async (projectId) => {
      this.assertNoQueuedFailure("project-write", PROJECT_DELETE_ERROR_MESSAGE);
      const projects = removeProjectFromIndex(
        parseProjectsIndex(this.projectsIndexSource),
        projectId,
      );
      this.projectSources.delete(projectId);
      this.deleteTimelinesForProject(projectId);
      this.projectsIndexSource = JSON.stringify(projects);

      const unremoved: ProjectDeleteAuxiliary[] = [];
      if (this.consumeFailure("revision-write")) {
        unremoved.push("revisions");
      } else {
        this.deleteRevisionsForProject(projectId);
      }
      if (this.consumeFailure("provider-call-write")) {
        unremoved.push("providerCalls");
      } else {
        this.deleteProviderCallsForProject(projectId);
      }
      return { unremoved };
    },
  };

  readonly timelines: TimelinePersistence = {
    load: async (projectId, moduleId) =>
      parseTimelineData(
        this.timelineSources.get(
          getTimelineStorageKey(projectId, moduleId),
        ) ?? null,
      ),
    save: async (projectId, moduleId, data) => {
      if (this.consumeFailure("timeline-save")) return false;
      try {
        const source = JSON.stringify(data);
        this.timelineSources.set(
          getTimelineStorageKey(projectId, moduleId),
          source === undefined ? "undefined" : source,
        );
        return true;
      } catch {
        // A full storage or unserializable data is reported to the timeline,
        // which trims history and retries instead of surfacing an error.
        return false;
      }
    },
  };

  readonly revisions: RevisionPersistence = {
    list: async (projectId, moduleId) => {
      if (this.consumeFailure("revision-read")) {
        throw new Error(REVISION_SNAPSHOT_LOAD_ERROR_MESSAGE);
      }
      return this.revisionSnapshotsForScope(projectId, moduleId).map(
        (snapshot) => structuredClone(snapshot),
      );
    },
    save: async (projectId, moduleId, data, label, pinned = false) => {
      if (this.consumeFailure("revision-write")) {
        throw new Error("Could not save the revision snapshot.");
      }
      const snapshot = createRevisionSnapshot({
        projectId,
        moduleId,
        data,
        label,
        pinned,
        id: this.createRevisionSnapshotId(),
        now: this.now(),
      });
      // The stored copy is separate from the returned one, as IndexedDB does.
      this.revisionSnapshots.set(snapshot.id, structuredClone(snapshot));

      const removableIds = snapshotIdsToPrune(
        this.revisionSnapshotsForScope(projectId, moduleId),
      );
      for (const id of removableIds) this.revisionSnapshots.delete(id);
      return snapshot;
    },
    setPinned: async (snapshotId, pinned) => {
      if (this.consumeFailure("revision-write")) {
        throw new Error("Could not update the revision snapshot.");
      }
      const snapshot = this.revisionSnapshots.get(snapshotId);
      if (snapshot == null) {
        throw new Error(REVISION_SNAPSHOT_MISSING_MESSAGE);
      }
      this.revisionSnapshots.set(
        snapshotId,
        structuredClone({ ...snapshot, pinned }),
      );
    },
    delete: async (snapshotId) => {
      if (this.consumeFailure("revision-write")) {
        throw new Error("Could not delete the revision snapshot.");
      }
      this.revisionSnapshots.delete(snapshotId);
    },
  };

  readonly providerCalls: ProviderCallPersistence = {
    load: async (projectId, moduleId) => {
      if (this.consumeFailure("provider-call-read")) {
        throw new ProviderCallStorageError(PROVIDER_CALL_LOAD_ERROR_MESSAGE);
      }
      const scopeId = moduleScopeId(projectId, moduleId);
      const rows = this.providerCallsByProject.get(projectId);
      if (rows == null) return [];
      return [...rows.values()]
        .filter((row) => row.scopeId === scopeId)
        .map((row) => toProviderCall(structuredClone(row)))
        .sort(compareProviderCallsOldestFirst);
    },
    replace: async (projectId, moduleId, calls) => {
      if (this.consumeFailure("provider-call-write")) {
        throw new ProviderCallStorageError(PROVIDER_CALL_SAVE_ERROR_MESSAGE);
      }
      try {
        const scopeId = moduleScopeId(projectId, moduleId);
        const replacement = new Map<string, StoredProviderCall>();
        for (const call of calls) {
          replacement.set(
            call.id,
            structuredClone(
              toStoredProviderCall(call, projectId, scopeId),
            ),
          );
        }

        const rows = this.providerCallsByProject.get(projectId);
        if (rows == null) {
          this.providerCallsByProject.set(projectId, replacement);
          return;
        }
        for (const [id, row] of rows) {
          if (row.scopeId === scopeId) rows.delete(id);
        }
        for (const [id, row] of replacement) rows.set(id, row);
      } catch (error) {
        if (error instanceof ProviderCallStorageError) throw error;
        throw new ProviderCallStorageError(
          PROVIDER_CALL_SAVE_ERROR_MESSAGE,
          error,
        );
      }
    },
  };

  /** Queue a failure for the next call of the given kind. */
  failNext(operation: MemoryPersistenceFailure): void {
    this.pendingFailures.push(operation);
  }

  private serialize(value: unknown, message: string): string | undefined {
    try {
      return JSON.stringify(value);
    } catch (error) {
      throw new ProjectStorageError(message, error);
    }
  }

  private loadProjectData(projectId: string): Record<string, unknown> | null {
    return parseStoredProjectData(this.projectSources.get(projectId) ?? null);
  }

  private revisionSnapshotsForScope(
    projectId: string,
    moduleId: string,
  ): ProjectRevisionSnapshot[] {
    const scopeId = moduleScopeId(projectId, moduleId);
    return sortRevisionSnapshotsNewestFirst(
      [...this.revisionSnapshots.values()].filter(
        (snapshot) => snapshot.scopeId === scopeId,
      ),
    );
  }

  private deleteTimelinesForProject(projectId: string): void {
    for (const key of [...this.timelineSources.keys()]) {
      if (isProjectTimelineStorageKey(key, projectId)) {
        this.timelineSources.delete(key);
      }
    }
  }

  private deleteRevisionsForProject(projectId: string): void {
    for (const [id, snapshot] of this.revisionSnapshots) {
      if (snapshot.projectId === projectId) this.revisionSnapshots.delete(id);
    }
  }

  private deleteProviderCallsForProject(projectId: string): void {
    this.providerCallsByProject.delete(projectId);
  }

  private consumeFailure(operation: MemoryPersistenceFailure): boolean {
    const index = this.pendingFailures.indexOf(operation);
    if (index < 0) return false;
    this.pendingFailures.splice(index, 1);
    return true;
  }

  private assertNoQueuedFailure(
    operation: MemoryPersistenceFailure,
    message: string,
  ): void {
    if (this.consumeFailure(operation)) {
      throw new ProjectStorageError(message);
    }
  }
}
