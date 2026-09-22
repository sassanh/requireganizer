import { LEGACY_MODULE_ID, moduleScopeId } from "./moduleSchema";
import type { ProviderCallRecord } from "./types";

const DATABASE_NAME = "requireganizer-provider-activity";
const DATABASE_VERSION = 2;
const STORE_NAME = "providerCalls";
const PROJECT_INDEX = "byProject";
const SCOPE_INDEX = "byScope";

interface StoredProviderCall extends ProviderCallRecord {
  projectId: string;
  /** `${projectId}::${moduleId}`; written since schema v2 of this database. */
  scopeId: string;
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
      const store = database.objectStoreNames.contains(STORE_NAME)
        ? request.transaction!.objectStore(STORE_NAME)
        : database.createObjectStore(STORE_NAME, {
            keyPath: ["projectId", "id"],
          });
      if (!store.indexNames.contains(PROJECT_INDEX)) {
        store.createIndex(PROJECT_INDEX, "projectId", { unique: false });
      }
      if (!store.indexNames.contains(SCOPE_INDEX)) {
        store.createIndex(SCOPE_INDEX, "scopeId", { unique: false });
      }
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

function removeScopeRows(
  store: IDBObjectStore,
  scopeId: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = store
      .index(SCOPE_INDEX)
      .openKeyCursor(IDBKeyRange.only(scopeId));

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

function toProviderCall(row: StoredProviderCall): ProviderCallRecord {
  const { projectId: _projectId, scopeId: _scopeId, ...call } = row;
  return call;
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
      const row = cursor.value as StoredProviderCall & { scopeId?: string };
      if (row.scopeId == null) {
        cursor.update({
          ...row,
          scopeId: moduleScopeId(row.projectId, LEGACY_MODULE_ID),
        });
      }
      cursor.continue();
    };
    request.onerror = () =>
      reject(request.error ?? new Error("Could not scope provider activity rows."));
  });
  await completion;
}

export async function loadProviderCalls(
  projectId: string,
  moduleId: string,
): Promise<ProviderCallRecord[]> {
  try {
    const database = await openDatabase();
    try {
      await ensureScopeBackfill(database);
      const transaction = database.transaction(STORE_NAME, "readonly");
      const completion = transactionComplete(transaction);
      const rows = await requestResult(
        transaction
          .objectStore(STORE_NAME)
          .index(SCOPE_INDEX)
          .getAll(IDBKeyRange.only(moduleScopeId(projectId, moduleId))),
      );
      await completion;
      return (rows as StoredProviderCall[])
        .map(toProviderCall)
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
  moduleId: string,
  calls: readonly ProviderCallRecord[],
): Promise<void> {
  try {
    const database = await openDatabase();
    try {
      await ensureScopeBackfill(database);
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const completion = transactionComplete(transaction);
      const scopeId = moduleScopeId(projectId, moduleId);
      await removeScopeRows(store, scopeId);
      for (const call of calls) {
        store.put({ ...call, projectId, scopeId } satisfies StoredProviderCall);
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
