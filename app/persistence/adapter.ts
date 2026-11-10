import type { Address, ProjectHistory, ProjectState } from "storage-and-recovery";

import type { ProjectIdentity, ProjectMeta } from "../lib/projectStorage";

/**
 * Everything one write of a project stores: the project, the pieces its
 * history names that storage does not hold yet, and the history.
 */
export interface ProjectWrite {
  project: ProjectIdentity;
  state: ProjectState;
  /** The state's address. */
  address: Address;
  pieces: readonly (readonly [Address, string])[];
  /** The history while the project is written: it names the state as being written. */
  writing: ProjectHistory;
  /** The history once the project is written: it names the state as last written. */
  written: ProjectHistory;
}

/**
 * The stored projects. A storage that writes in steps writes the pieces
 * first, then `writing`, then the project, then `written`; one that writes
 * in a transaction writes the project, pieces and `written` together.
 *
 * A read issued after a write to the same project observes that write.
 */
export interface ProjectPersistence {
  /**
   * Every stored project, oldest first. Resolves `[]` when nothing is stored
   * or storage is unavailable.
   */
  list(): Promise<ProjectMeta[]>;

  /**
   * One project's stored document, for `parseProject` to read; null when
   * nothing is stored for it. Rejects when it cannot be read.
   */
  load(projectId: string): Promise<unknown>;

  /**
   * Store a project that storage does not hold yet. Rejects with
   * `ProjectStorageError`, storing nothing, when it already holds one by
   * that id, or when the storage holds one project and has it.
   */
  create(write: ProjectWrite): Promise<void>;

  /**
   * Write a project over what is stored, the name in its identity included.
   * Rejects with `ProjectStorageError` when it could not be stored.
   *
   * The write is issued before the returned promise is created; adapters
   * must not reorder writes for the same project. Callers rely on this to
   * keep the final flush during page unload synchronous.
   */
  write(write: ProjectWrite): Promise<void>;

  /** Remove everything stored for the project: itself, its history and its pieces. */
  delete(projectId: string): Promise<void>;
}

/**
 * The history and pieces stored beside each project. Only the project's
 * authority reads them; no client reaches them.
 */
export interface HistoryPersistence {
  /** The project's stored history; null when it has none. Rejects when it cannot be read. */
  load(projectId: string): Promise<ProjectHistory | null>;
  /** The address of every piece stored for the project. */
  pieceAddresses(projectId: string): Promise<Address[]>;
  /** One stored piece's bytes; null when it is not stored. */
  readPiece(projectId: string, address: Address): Promise<string | null>;
  deletePieces(projectId: string, addresses: readonly Address[]): Promise<void>;
}

/** What the interface needs to know about a storage to describe it. */
export interface StorageTraits {
  /** The storage holds one project; there is no project list to choose from. */
  singleProject: boolean;
  /** How messages name the storage, such as "browser storage". */
  name: string;
}

/**
 * How the stored project differs from what its adapter last adopted or wrote,
 * because something else changed it, such as a checkout of the project file.
 * `problem` says why the changed project cannot be opened; null when it can.
 */
export type OutsideChange = { kind: "changed"; problem: string | null } | { kind: "removed" };

/**
 * Changes made to the stored project outside the adapter. While one stands,
 * the adapter refuses to write the project, so neither version is lost.
 */
export interface OutsideChanges {
  /**
   * Call `listener` with the change whenever it differs from the last one,
   * null once the stored project is again what the adapter last adopted or
   * wrote. Returns a function that stops watching.
   */
  watch(listener: (change: OutsideChange | null) => void): () => void;
  /**
   * Hold the stored project as it is now, as when opening it, so the next
   * write may replace it. False, holding nothing new, while it cannot be read
   * or holds another project. Loads never change what the adapter holds.
   */
  adoptStored(): boolean;
}

/**
 * All persistence the application needs, grouped by concern. Every member
 * is asynchronous so a project can also live in files served by a local
 * process or in a remote Durable Object.
 */
export interface PersistenceAdapter {
  readonly traits: StorageTraits;
  readonly projects: ProjectPersistence;
  readonly history: HistoryPersistence;
}

/** The storage operations a client may ask the host for. */
export interface ClientPersistence {
  readonly traits: StorageTraits;
  readonly projects: Pick<ProjectPersistence, "list" | "delete">;
}
