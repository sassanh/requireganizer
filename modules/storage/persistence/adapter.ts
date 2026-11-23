import type { ProjectIdentity, ProjectMeta } from "lib/projectStorage";
import type { Address, OutsideChange, ProjectRecord, ProjectState } from "storage";


/**
 * Everything one write of a project stores: the project, the pieces its
 * record names that storage does not hold yet, and the record.
 */
export interface ProjectWrite {
  project: ProjectIdentity;
  state: ProjectState;
  /** The state's address. */
  address: Address;
  pieces: readonly (readonly [Address, string])[];
  /** The record while the project is written: it names the state as being written. */
  writing: ProjectRecord;
  /** The record once the project is written: it names the state as last written. */
  written: ProjectRecord;
  /**
   * The spec owner chose to write this over a stored project changed
   * outside Requireganizer. Without it, a storage that has outside changes
   * refuses to replace one, unless it holds this very state.
   */
  overOutsideChange: boolean;
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
   * Adapters must not reorder writes for the same project. One in a page
   * issues the write before the returned promise is created, so a final
   * flush during page unload stores it; one in a process that waits for its
   * writes before ending, such as a server, may issue it later.
   */
  write(write: ProjectWrite): Promise<void>;

  /**
   * Remove everything stored for the project: itself, its record and its
   * pieces. A storage whose project is a file a person keeps, such as one in
   * a repository, never removes that file: it rejects while the file is
   * there, and once the file is gone it removes the record and pieces.
   */
  delete(projectId: string): Promise<void>;
}

/**
 * The record and pieces stored beside each project. Only the project's
 * authority reads them; no client reaches them.
 */
export interface RecordPersistence {
  /** The project's stored record; null when it has none. Rejects when it cannot be read. */
  load(projectId: string): Promise<ProjectRecord | null>;
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
 * Changes made to the stored project outside Requireganizer, by the one
 * rule `storedProjectChange` applies to the stored project and its record.
 * While one stands, the adapter refuses to write over it, so neither project
 * is lost.
 */
export interface OutsideChanges {
  /**
   * Call `listener` with the change at once, then whenever it differs from
   * the last one, null once the stored project is again one Requireganizer
   * wrote. Returns a function that stops watching.
   */
  watch(listener: (change: OutsideChange | null) => void): () => void;
}

/**
 * All persistence the application needs, grouped by concern. Every member
 * is asynchronous so a project can also live in files served by a local
 * process or in a remote Durable Object.
 */
export interface PersistenceAdapter {
  readonly traits: StorageTraits;
  readonly projects: ProjectPersistence;
  readonly record: RecordPersistence;
}

/** The storage operations a client may ask the host for. */
export interface ClientPersistence {
  readonly traits: StorageTraits;
  readonly projects: Pick<ProjectPersistence, "list">;
}
