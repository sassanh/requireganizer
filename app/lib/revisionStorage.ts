const DATABASE_NAME = "requireganizer-revisions";
const DATABASE_VERSION = 1;
const STORE_NAME = "projectSnapshots";
const PROJECT_INDEX = "projectId";
const MAX_UNPINNED = 20;

export interface ProjectRevisionSnapshot {
  id: string;
  projectId: string;
  createdAt: string;
  label: string;
  pinned: boolean;
  data: unknown;
}

export function snapshotIdsToPrune(
  snapshots: readonly Pick<
    ProjectRevisionSnapshot,
    "id" | "createdAt" | "pinned"
  >[],
  maximumUnpinned = MAX_UNPINNED,
): string[] {
  return [...snapshots]
    .filter((item) => !item.pinned)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
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
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open revision storage."));
  });
}

export async function listProjectSnapshots(projectId: string): Promise<ProjectRevisionSnapshot[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const completion = transactionComplete(transaction);
    const values = await requestResult(
      transaction.objectStore(STORE_NAME).index(PROJECT_INDEX).getAll(IDBKeyRange.only(projectId)),
    ) as ProjectRevisionSnapshot[];
    await completion;
    return values.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } finally {
    database.close();
  }
}

export async function saveProjectSnapshot(
  projectId: string,
  data: unknown,
  label: string,
  pinned = false,
): Promise<ProjectRevisionSnapshot> {
  const snapshot: ProjectRevisionSnapshot = {
    id: crypto.randomUUID(),
    projectId,
    createdAt: new Date().toISOString(),
    label,
    pinned,
    data: structuredClone(data),
  };
  const database = await openDatabase();
  try {
    let transaction = database.transaction(STORE_NAME, "readwrite");
    let completion = transactionComplete(transaction);
    transaction.objectStore(STORE_NAME).put(snapshot);
    await completion;

    const snapshots = await listProjectSnapshots(projectId);
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
    if (snapshot == null) throw new Error("Revision snapshot no longer exists.");
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
  const snapshots = await listProjectSnapshots(projectId);
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
