import type { ProjectMeta } from "../lib/projectStorage";
import type { ProjectRevisionSnapshot } from "../lib/revisionStorage";
import type { ProviderCallRecord } from "../lib/types";

/** Auxiliary stores a project delete removes besides its own record. */
export type ProjectDeleteAuxiliary = "revisions" | "providerCalls";

export interface ProjectDeleteResult {
  /**
   * Auxiliary stores that could not be removed, ordered `revisions` then
   * `providerCalls`. Empty when the delete was complete. The project payload,
   * timelines, and index entry are gone whenever the promise resolves.
   */
  unremoved: ProjectDeleteAuxiliary[];
}

/**
 * The projects index and project payloads. Each project payload is the
 * registry plus every module snapshot, exactly as it is exported.
 */
export interface ProjectPersistence {
  /**
   * Every stored project, in stored order. Resolves `[]` when nothing is
   * stored, when storage is unavailable, or when the stored index cannot be
   * read; malformed and duplicate entries are filtered out.
   */
  list(): Promise<ProjectMeta[]>;

  /**
   * Replaces the projects index. Rejects with `ProjectStorageError` when
   * storage is unavailable or the index cannot be serialized or written.
   */
  saveIndex(projects: ProjectMeta[]): Promise<void>;

  /**
   * The stored payload for one project. Resolves `null` when nothing is
   * stored for the id or the stored bytes are not a JSON object. This read
   * does not reject; unreadable or unavailable storage is reported as `null`.
   */
  load(projectId: string): Promise<Record<string, unknown> | null>;

  /**
   * Writes one project payload, replacing any previous payload. Rejects with
   * `ProjectStorageError` when storage is unavailable or the payload cannot
   * be serialized or written.
   */
  save(projectId: string, data: unknown): Promise<void>;

  /**
   * Writes a project payload and the updated projects index together, for
   * creating or importing a project. Either both are stored or neither is.
   * Rejects with `ProjectStorageError` when the data cannot be serialized or
   * either write fails.
   */
  saveBundle(
    projectId: string,
    data: unknown,
    projects: ProjectMeta[],
  ): Promise<void>;

  /**
   * Removes everything stored for the project: its payload, every module
   * timeline, its projects-index entry, its revision snapshots, and its
   * provider-call logs.
   *
   * Rejects with `ProjectStorageError` when the project itself could not be
   * removed. When that part succeeds, the promise resolves even if an
   * auxiliary store failed; the returned `unremoved` list names the parts
   * that remain, so the caller can report them without losing the fact that
   * the project is gone.
   */
  delete(projectId: string): Promise<ProjectDeleteResult>;
}

/**
 * One timeline per project module. A timeline is written whole on every
 * save; the timeline controller trims history itself when a save fails.
 */
export interface TimelinePersistence {
  /**
   * The stored timeline for one module. Resolves `null` when nothing is
   * stored, the stored bytes are not an object, or the timeline version is
   * not the current one.
   */
  load(
    projectId: string,
    moduleId: string,
  ): Promise<Record<string, unknown> | null>;

  /**
   * Writes one module timeline. Resolves `true` on success and `false` when
   * the write fails — including a full or unavailable storage — rather than
   * rejecting, because the timeline controller relies on `false` to trim
   * history and retry.
   */
  save(projectId: string, moduleId: string, data: unknown): Promise<boolean>;
}

/**
 * Revision snapshots: the recovery points shown in the revision history.
 * Snapshots are scoped to one project module.
 */
export interface RevisionPersistence {
  /**
   * The module's snapshots, newest first. Ties on `createdAt` are ordered by
   * snapshot id descending, so quick saves have a deterministic order.
   * Resolves `[]` when none are stored. Rejects when storage is unavailable
   * or the read fails.
   */
  list(
    projectId: string,
    moduleId: string,
  ): Promise<ProjectRevisionSnapshot[]>;

  /**
   * Stores a snapshot of the module's data and returns it. Unpinned
   * snapshots beyond the retention limit are pruned as part of the save,
   * while pinned snapshots are kept. Rejects when the storage write fails.
   */
  save(
    projectId: string,
    moduleId: string,
    data: unknown,
    label: string,
    pinned?: boolean,
  ): Promise<ProjectRevisionSnapshot>;

  /**
   * Pins or unpins one snapshot. Rejects when the snapshot no longer
   * exists or the write fails.
   */
  setPinned(snapshotId: string, pinned: boolean): Promise<void>;

  /** Deletes one snapshot; deleting a missing snapshot is not an error. */
  delete(snapshotId: string): Promise<void>;
}

/**
 * AI provider-call logs, one log per project module. Logs are replaced
 * wholesale so the store remains the source of truth for the current list.
 */
export interface ProviderCallPersistence {
  /**
   * The module's calls, oldest first by `startedAt`; equal start times are
   * ordered by call id ascending by UTF-16 code unit, matching the storage
   * key order. Resolves `[]` when none are stored. Rejects with
   * `ProviderCallStorageError` when storage is unavailable or the read fails.
   */
  load(projectId: string, moduleId: string): Promise<ProviderCallRecord[]>;

  /**
   * Replaces every stored call for the module with the given calls. A call
   * id is unique per project across all modules, matching the storage key
   * (`projectId`, call id): replacing one module's calls takes over a row
   * with the same id from another module. Duplicate ids within the
   * replacement keep their last occurrence; the stored order is not
   * significant because `load` orders the result. Rejects with
   * `ProviderCallStorageError` when storage is unavailable or the write
   * fails, leaving the previous calls in place.
   */
  replace(
    projectId: string,
    moduleId: string,
    calls: readonly ProviderCallRecord[],
  ): Promise<void>;
}

/**
 * All persistence the application needs, grouped by concern. Every member
 * is asynchronous so a project can also live in files served by a local
 * process or in a remote Durable Object.
 */
export interface PersistenceAdapter {
  readonly projects: ProjectPersistence;
  readonly timelines: TimelinePersistence;
  readonly revisions: RevisionPersistence;
  readonly providerCalls: ProviderCallPersistence;
}
