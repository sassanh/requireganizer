import { parseHistory, serializeCanonical, serializeProject } from "storage-and-recovery";

import type { HistoryPersistence, PersistenceAdapter, ProjectPersistence, ProjectWrite } from "./adapter";
import {
  PROJECT_DELETE_ERROR_MESSAGE,
  PROJECT_SAVE_ERROR_MESSAGE,
  type ProjectMeta,
  ProjectStorageError,
} from "../lib/projectStorage";

const DATABASE_NAME = "requireganizer-projects";
const DATABASE_VERSION = 1;
/** Each project's identity and times, keyed by its id. */
const PROJECTS = "projects";
/** Each project's bytes, keyed by its id. */
const DOCUMENTS = "documents";
/** Each project's history, keyed by its id. */
const HISTORIES = "histories";
/** Each project's pieces, keyed by its id and the piece's address. */
const PIECES = "pieces";
const ALL_STORES = [PROJECTS, DOCUMENTS, HISTORIES, PIECES];

interface ProjectRecord extends ProjectMeta {
  createdAt: string;
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

/** Every piece key of one project. */
function piecesOf(projectId: string): IDBKeyRange {
  return IDBKeyRange.bound([projectId], [projectId, []]);
}

/**
 * A `PersistenceAdapter` over the browser's IndexedDB. A write stores the
 * project, its pieces, its history and its entry in the project list in one
 * transaction, so storage never holds one without the others.
 */
export class WebPersistenceAdapter implements PersistenceAdapter {
  readonly traits = { singleProject: false, name: "browser storage" };
  private database: IDBDatabase | null = null;
  private opening: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (this.opening != null) return this.opening;
    if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB is unavailable."));
    this.opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        for (const name of ALL_STORES) {
          if (!database.objectStoreNames.contains(name)) {
            database.createObjectStore(name, name === PROJECTS ? { keyPath: "id" } : undefined);
          }
        }
      };
      request.onsuccess = () => {
        this.database = request.result;
        resolve(request.result);
      };
      request.onerror = () => reject(request.error ?? new Error("Could not open browser storage."));
    });
    // A failed open is tried again next time.
    this.opening.catch(() => {
      this.opening = null;
    });
    return this.opening;
  }

  /**
   * Run `work` in a transaction over the given stores. While the database is
   * open, the transaction starts before this returns, so transactions keep
   * the order they were asked for in, even during page unload.
   */
  private transact<Result>(
    stores: readonly string[],
    mode: IDBTransactionMode,
    work: (transaction: IDBTransaction) => Promise<Result> | Result,
  ): Promise<Result> {
    const run = async (database: IDBDatabase): Promise<Result> => {
      const transaction = database.transaction([...stores], mode);
      const complete = transactionComplete(transaction);
      const result = await work(transaction);
      await complete;
      return result;
    };
    return this.database != null ? run(this.database) : this.open().then(run);
  }

  private store(write: ProjectWrite, creating: boolean): Promise<void> {
    return this.transact(ALL_STORES, "readwrite", (transaction) => {
      const projects = transaction.objectStore(PROJECTS);
      const now = new Date().toISOString();
      const lookup = projects.get(write.project.id);
      lookup.onsuccess = () => {
        const existing = lookup.result as ProjectRecord | undefined;
        if (creating && existing != null) {
          transaction.abort();
          return;
        }
        const record: ProjectRecord = { ...write.project, createdAt: existing?.createdAt ?? now, updatedAt: now };
        projects.put(record);
      };
      transaction.objectStore(DOCUMENTS).put(serializeProject(write.state), write.project.id);
      transaction.objectStore(HISTORIES).put(serializeCanonical(write.written), write.project.id);
      const pieces = transaction.objectStore(PIECES);
      for (const [address, bytes] of write.pieces) pieces.put(bytes, [write.project.id, address]);
    });
  }

  readonly projects: ProjectPersistence = {
    list: async () => {
      try {
        const records = await this.transact([PROJECTS], "readonly", (transaction) =>
          requestResult(transaction.objectStore(PROJECTS).getAll() as IDBRequest<ProjectRecord[]>),
        );
        return records
          .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
          .map(({ id, name, updatedAt }) => ({ id, name, updatedAt }));
      } catch {
        return [];
      }
    },
    load: async (projectId) => {
      const source = await this.transact([DOCUMENTS], "readonly", (transaction) =>
        requestResult(transaction.objectStore(DOCUMENTS).get(projectId) as IDBRequest<string | undefined>),
      );
      return source == null ? null : (JSON.parse(source) as unknown);
    },
    create: async (write) => {
      try {
        await this.store(write, true);
      } catch (error) {
        throw new ProjectStorageError(PROJECT_SAVE_ERROR_MESSAGE, error);
      }
    },
    write: (write) =>
      this.store(write, false).catch((error: unknown) => {
        throw new ProjectStorageError(PROJECT_SAVE_ERROR_MESSAGE, error);
      }),
    delete: async (projectId) => {
      try {
        await this.transact(ALL_STORES, "readwrite", (transaction) => {
          transaction.objectStore(PROJECTS).delete(projectId);
          transaction.objectStore(DOCUMENTS).delete(projectId);
          transaction.objectStore(HISTORIES).delete(projectId);
          transaction.objectStore(PIECES).delete(piecesOf(projectId));
        });
      } catch (error) {
        throw new ProjectStorageError(PROJECT_DELETE_ERROR_MESSAGE, error);
      }
    },
  };

  readonly history: HistoryPersistence = {
    load: async (projectId) => {
      const source = await this.transact([HISTORIES], "readonly", (transaction) =>
        requestResult(transaction.objectStore(HISTORIES).get(projectId) as IDBRequest<string | undefined>),
      );
      return source == null ? null : parseHistory(JSON.parse(source));
    },
    pieceAddresses: async (projectId) => {
      const keys = await this.transact([PIECES], "readonly", (transaction) =>
        requestResult(transaction.objectStore(PIECES).getAllKeys(piecesOf(projectId))),
      );
      return keys.map((key) => (key as [string, string])[1]);
    },
    readPiece: async (projectId, address) => {
      const bytes = await this.transact([PIECES], "readonly", (transaction) =>
        requestResult(transaction.objectStore(PIECES).get([projectId, address]) as IDBRequest<string | undefined>),
      );
      return bytes ?? null;
    },
    deletePieces: async (projectId, addresses) => {
      await this.transact([PIECES], "readwrite", (transaction) => {
        const pieces = transaction.objectStore(PIECES);
        for (const address of addresses) pieces.delete([projectId, address]);
      });
    },
  };
}

/** The application's browser-storage adapter. */
export const webPersistence = new WebPersistenceAdapter();
