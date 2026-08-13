import type { ProviderCallRecord } from "./types";

const DATABASE_NAME = "requireganizer-provider-activity";
const DATABASE_VERSION = 1;
const STORE_NAME = "providerCalls";
const PROJECT_INDEX = "byProject";

interface StoredProviderCall extends ProviderCallRecord {
  projectId: string;
}

export class ProviderCallStorageError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ProviderCallStorageError";
  }
}

function requestResult<Value>(request: IDBRequest<Value>): Promise<Value> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(
      new ProviderCallStorageError("IndexedDB is unavailable."),
    );
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      const store = database.createObjectStore(STORE_NAME, {
        keyPath: ["projectId", "id"],
      });
      store.createIndex(PROJECT_INDEX, "projectId", { unique: false });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new ProviderCallStorageError("The provider call database is blocked."));
  });
}

function removeProjectRows(
  store: IDBObjectStore,
  projectId: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = store
      .index(PROJECT_INDEX)
      .openKeyCursor(IDBKeyRange.only(projectId));

    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor == null) {
        resolve();
        return;
      }
      store.delete(cursor.primaryKey);
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}

function withoutProjectId(row: StoredProviderCall): ProviderCallRecord {
  const { projectId: _projectId, ...call } = row;
  return call;
}

export async function loadProviderCalls(
  projectId: string,
): Promise<ProviderCallRecord[]> {
  try {
    const database = await openDatabase();
    try {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const completion = transactionComplete(transaction);
      const rows = await requestResult(
        transaction
          .objectStore(STORE_NAME)
          .index(PROJECT_INDEX)
          .getAll(IDBKeyRange.only(projectId)),
      );
      await completion;
      return (rows as StoredProviderCall[])
        .map(withoutProjectId)
        .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
    } finally {
      database.close();
    }
  } catch (error) {
    if (error instanceof ProviderCallStorageError) throw error;
    throw new ProviderCallStorageError(
      "Could not load AI provider activity.",
      error,
    );
  }
}

export async function replaceProviderCalls(
  projectId: string,
  calls: readonly ProviderCallRecord[],
): Promise<void> {
  try {
    const database = await openDatabase();
    try {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const completion = transactionComplete(transaction);
      await removeProjectRows(store, projectId);
      for (const call of calls) {
        store.put({ ...call, projectId } satisfies StoredProviderCall);
      }
      await completion;
    } finally {
      database.close();
    }
  } catch (error) {
    if (error instanceof ProviderCallStorageError) throw error;
    throw new ProviderCallStorageError(
      "Could not save AI provider activity.",
      error,
    );
  }
}

export async function deleteProviderCallsForProject(
  projectId: string,
): Promise<void> {
  try {
    const database = await openDatabase();
    try {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const completion = transactionComplete(transaction);
      await removeProjectRows(transaction.objectStore(STORE_NAME), projectId);
      await completion;
    } finally {
      database.close();
    }
  } catch (error) {
    if (error instanceof ProviderCallStorageError) throw error;
    throw new ProviderCallStorageError(
      "Could not delete AI provider activity.",
      error,
    );
  }
}

export function mergeProviderCalls(
  stored: readonly ProviderCallRecord[],
  current: readonly ProviderCallRecord[],
  maximum: number,
): ProviderCallRecord[] {
  const callsById = new Map<string, ProviderCallRecord>();
  for (const call of [...stored, ...current]) callsById.set(call.id, call);
  return [...callsById.values()]
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt))
    .slice(-maximum);
}
