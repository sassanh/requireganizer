import { LEGACY_MODULE_ID, moduleScopeId } from "./moduleSchema";

const DATABASE_NAME = "requireganizer-revisions";
const DATABASE_VERSION = 2;
const STORE_NAME = "projectSnapshots";
const PROJECT_INDEX = "projectId";
const SCOPE_INDEX = "scopeId";
const MAX_UNPINNED = 20;

export interface ProjectRevisionSnapshot {
  id: string;
  projectId: string;
  /** `${projectId}::${moduleId}`; written since schema v2 of this database. */
  scopeId: string;
  createdAt: string;
  label: string;
  pinned: boolean;
  data: unknown;
}

export const REVISION_SNAPSHOT_MISSING_MESSAGE =
  "Revision snapshot no longer exists.";
export const REVISION_SNAPSHOT_LOAD_ERROR_MESSAGE =
  "Could not load revision snapshots.";

/**
 * Newest first by creation time. Timestamps have millisecond resolution, so
 * snapshots saved in the same millisecond are ordered by id, descending;
 * callers that need save order across a tie generate increasing ids.
 */
export function compareRevisionSnapshotsNewestFirst(
  left: Pick<ProjectRevisionSnapshot, "id" | "createdAt">,
  right: Pick<ProjectRevisionSnapshot, "id" | "createdAt">,
): number {
  const byCreatedAt = right.createdAt.localeCompare(left.createdAt);
  if (byCreatedAt !== 0) return byCreatedAt;
  return right.id.localeCompare(left.id);
}

export function sortRevisionSnapshotsNewestFirst<
  Snapshot extends Pick<ProjectRevisionSnapshot, "id" | "createdAt">,
>(snapshots: readonly Snapshot[]): Snapshot[] {
  return [...snapshots].sort(compareRevisionSnapshotsNewestFirst);
}

export interface RevisionSnapshotInput {
  projectId: string;
  moduleId: string;
  data: unknown;
  label: string;
  pinned?: boolean;
  id?: string;
  now?: Date;
}

/** The one snapshot-record factory for web storage and the memory adapter. */
export function createRevisionSnapshot({
  projectId,
  moduleId,
  data,
  label,
  pinned = false,
  id = crypto.randomUUID(),
  now = new Date(),
}: RevisionSnapshotInput): ProjectRevisionSnapshot {
  return {
    id,
    projectId,
    scopeId: moduleScopeId(projectId, moduleId),
    createdAt: now.toISOString(),
    label,
    pinned,
    data: structuredClone(data),
  };
}

export function snapshotIdsToPrune(
  snapshots: readonly Pick<
    ProjectRevisionSnapshot,
    "id" | "createdAt" | "pinned"
  >[],
  maximumUnpinned = MAX_UNPINNED,
): string[] {
  return sortRevisionSnapshotsNewestFirst(
    snapshots.filter((item) => !item.pinned),
  )
    .slice(maximumUnpinned)
    .map(({ id }) => id);
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction was aborted."));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB is unavailable."));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      const store = database.objectStoreNames.contains(STORE_NAME)
        ? request.transaction!.objectStore(STORE_NAME)
        : database.createObjectStore(STORE_NAME, { keyPath: "id" });
      if (!store.indexNames.contains(PROJECT_INDEX)) store.createIndex(PROJECT_INDEX, PROJECT_INDEX, { unique: false });
      if (!store.indexNames.contains(SCOPE_INDEX)) store.createIndex(SCOPE_INDEX, SCOPE_INDEX, { unique: false });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open revision storage."));
  });
}

let scopeBackfill: Promise<void> | null = null;

/**
 * Rows written before module scoping belong to the legacy single module;
 * give them their scope once, then never again.
 */
function ensureScopeBackfill(database: IDBDatabase): Promise<void> {
  if (scopeBackfill == null) {
    scopeBackfill = backfillScopeIds(database).catch((error: unknown) => {
      scopeBackfill = null;
      throw error;
    });
  }
  return scopeBackfill;
}

async function backfillScopeIds(database: IDBDatabase): Promise<void> {
  const transaction = database.transaction(STORE_NAME, "readwrite");
  const completion = transactionComplete(transaction);
  const store = transaction.objectStore(STORE_NAME);
  await new Promise<void>((resolve, reject) => {
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor == null) {
        resolve();
        return;
      }
      const row = cursor.value as ProjectRevisionSnapshot & { scopeId?: string };
      if (row.scopeId == null) {
        cursor.update({
          ...row,
          scopeId: moduleScopeId(row.projectId, LEGACY_MODULE_ID),
        });
      }
      cursor.continue();
    };
    request.onerror = () => reject(request.error ?? new Error("Could not scope revision snapshots."));
  });
  await completion;
}

async function listProjectSnapshotsAnywhere(projectId: string): Promise<ProjectRevisionSnapshot[]> {
  const database = await openDatabase();
  try {
    await ensureScopeBackfill(database);
    const transaction = database.transaction(STORE_NAME, "readonly");
    const completion = transactionComplete(transaction);
    const values = await requestResult(
      transaction.objectStore(STORE_NAME).index(PROJECT_INDEX).getAll(IDBKeyRange.only(projectId)),
    ) as ProjectRevisionSnapshot[];
    await completion;
    return sortRevisionSnapshotsNewestFirst(values);
  } finally {
    database.close();
  }
}

export async function listProjectSnapshots(
  projectId: string,
  moduleId: string,
): Promise<ProjectRevisionSnapshot[]> {
  const database = await openDatabase();
  try {
    await ensureScopeBackfill(database);
    const transaction = database.transaction(STORE_NAME, "readonly");
    const completion = transactionComplete(transaction);
    const values = await requestResult(
      transaction
        .objectStore(STORE_NAME)
        .index(SCOPE_INDEX)
        .getAll(IDBKeyRange.only(moduleScopeId(projectId, moduleId))),
    ) as ProjectRevisionSnapshot[];
    await completion;
    return sortRevisionSnapshotsNewestFirst(values);
  } finally {
    database.close();
  }
}

export async function saveProjectSnapshot(
  projectId: string,
  moduleId: string,
  data: unknown,
  label: string,
  pinned = false,
): Promise<ProjectRevisionSnapshot> {
  const snapshot = createRevisionSnapshot({
    projectId,
    moduleId,
    data,
    label,
    pinned,
  });
  const database = await openDatabase();
  try {
    await ensureScopeBackfill(database);
    let transaction = database.transaction(STORE_NAME, "readwrite");
    let completion = transactionComplete(transaction);
    transaction.objectStore(STORE_NAME).put(snapshot);
    await completion;

    const snapshots = await listProjectSnapshots(projectId, moduleId);
    const removableIds = snapshotIdsToPrune(snapshots);
    if (removableIds.length > 0) {
      transaction = database.transaction(STORE_NAME, "readwrite");
      completion = transactionComplete(transaction);
      const store = transaction.objectStore(STORE_NAME);
      removableIds.forEach((id) => store.delete(id));
      await completion;
    }
    return snapshot;
  } finally {
    database.close();
  }
}

export async function setSnapshotPinned(id: string, pinned: boolean): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const completion = transactionComplete(transaction);
    const store = transaction.objectStore(STORE_NAME);
    const snapshot = await requestResult(store.get(id)) as ProjectRevisionSnapshot | undefined;
    if (snapshot == null) throw new Error(REVISION_SNAPSHOT_MISSING_MESSAGE);
    store.put({ ...snapshot, pinned });
    await completion;
  } finally {
    database.close();
  }
}

export async function deleteProjectSnapshot(id: string): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const completion = transactionComplete(transaction);
    transaction.objectStore(STORE_NAME).delete(id);
    await completion;
  } finally {
    database.close();
  }
}

export async function deleteProjectSnapshots(projectId: string): Promise<void> {
  const snapshots = await listProjectSnapshotsAnywhere(projectId);
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const completion = transactionComplete(transaction);
    const store = transaction.objectStore(STORE_NAME);
    snapshots.forEach(({ id }) => store.delete(id));
    await completion;
  } finally {
    database.close();
  }
}
