import {
  existsSync,
  type FSWatcher,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  watch,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join } from "node:path";

import { UserFacingError } from "lib/errors";
import { parseJsonObject } from "lib/json";
import {
  PROJECT_DELETE_ERROR_MESSAGE,
  PROJECT_SAVE_ERROR_MESSAGE,
  type ProjectIdentity,
  type ProjectMeta,
  ProjectStorageError,
} from "lib/projectStorage";
import type {
  HistoryPersistence,
  OutsideChanges,
  PersistenceAdapter,
  ProjectPersistence,
  ProjectWrite,
  StorageTraits,
} from "persistence";
import {
  type Address,
  type OutsideChange,
  parseHistory,
  parseProject,
  PieceStore,
  type ProjectHistory,
  projectDocument,
  serializeCanonical,
  type StoredProject,
  storedProjectChange,
} from "storage-and-recovery";

/** The id of a project file that names none, such as an export placed by hand. */
export const DEFAULT_FILE_PROJECT_ID = "project";

/** The project's identity, stored beside its document. Its update time is the file's own. */
const IDENTITY_KEYS = ["id", "name"] as const;

interface ProjectFile {
  identity: ProjectIdentity;
  /** The project's document as stored, which `parseProject` read. */
  document: Record<string, unknown>;
  /** The address of the state it holds. */
  address: Address;
}

export interface FilePersistenceAdapterOptions {
  /** The project file, usually inside the repository it describes. */
  projectFile: string;
  /** Where the project's history and pieces live. */
  stateDirectory: string;
  now?: () => Date;
}

/**
 * Write a file whole or not at all: readers never see half of it. A file
 * that already holds these contents is left alone, so opening a project
 * changes nothing a version control system would see.
 */
function writeAtomically(path: string, contents: string): void {
  if (readIfPresent(path) === contents) return;
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, contents);
  renameSync(temporary, path);
}

function readIfPresent(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Edits to the project file are gathered this long before it is read, so one save is one change. */
const OUTSIDE_CHANGE_SETTLE_MS = 100;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A `PersistenceAdapter` that keeps one project in a file a person can read,
 * diff, and commit: the project's id and name beside its document, written
 * by the one canonical serializer, so a change touches only the lines that
 * hold it. A file without an id or name, such as an export placed by hand,
 * opens too. The project's history and its pieces live in a separate state
 * directory, since they are local work rather than part of the project.
 *
 * Writes are issued synchronously and replace files atomically, so they are
 * never reordered: the pieces first, then the history naming the state being
 * written, then the project file, then the history naming it as written.
 * Whether the project file changed outside Requireganizer, such as by a
 * checkout, is decided by `storedProjectChange` from the file and the
 * history in the state directory: `outsideChanges` reports such a change as
 * it happens, and a write over one is refused unless the spec owner chose it.
 */
export class FilePersistenceAdapter implements PersistenceAdapter {
  readonly traits: StorageTraits;
  private readonly projectFile: string;
  private readonly stateDirectory: string;
  private readonly now: () => Date;
  /**
   * The id of the project this adapter serves, once it loaded or wrote it.
   * A file that holds another project cannot be opened in its place.
   */
  private heldProjectId: string | null = null;
  /** The last project file read and what it holds, so an unchanged file is not read into a state again. */
  private lastRead: { source: string; file: ProjectFile } | null = null;
  private readonly outsideChangeListeners = new Set<(change: OutsideChange | null) => void>();
  private reportedOutsideChange: OutsideChange | null = null;
  private fileWatcher: FSWatcher | null = null;
  private outsideChangeCheck: ReturnType<typeof setTimeout> | null = null;

  constructor(options: FilePersistenceAdapterOptions) {
    this.projectFile = options.projectFile;
    this.stateDirectory = options.stateDirectory;
    this.now = options.now ?? (() => new Date());
    this.traits = { singleProject: true, name: basename(this.projectFile) };
  }

  /** The project file as stored, or null when there is none; throws what makes it unreadable. */
  readProjectFile(): ProjectFile | null {
    return this.parseProjectFile(readIfPresent(this.projectFile));
  }

  private defaultName(): string {
    return basename(this.traits.name, extname(this.traits.name));
  }

  private parseProjectFile(source: string | null): ProjectFile | null {
    if (source == null) return null;
    if (this.lastRead?.source === source) return this.lastRead.file;
    const label = this.traits.name;
    let value: Record<string, unknown>;
    try {
      value = parseJsonObject(source, label);
    } catch (error) {
      throw new UserFacingError(`${label} could not be read: ${messageOf(error)} Fix the file, then try again.`);
    }
    const document: Record<string, unknown> = { ...value };
    for (const key of IDENTITY_KEYS) delete document[key];
    let address: Address;
    try {
      address = new PieceStore().addressOf(parseProject(document));
    } catch (error) {
      throw new UserFacingError(`${label} does not hold a valid project: ${messageOf(error)} Fix the file, then try again.`);
    }
    const text = (key: string): string | null =>
      typeof value[key] === "string" && (value[key] as string).trim().length > 0 ? (value[key] as string) : null;
    const file: ProjectFile = {
      identity: { id: text("id") ?? DEFAULT_FILE_PROJECT_ID, name: text("name") ?? this.defaultName() },
      document,
      address,
    };
    this.lastRead = { source, file };
    return file;
  }

  private metaOf(identity: ProjectIdentity): ProjectMeta {
    return { ...identity, updatedAt: this.modifiedAt().toISOString() };
  }

  /** The project file as the rule for outside changes reads it. */
  private storedProject(): StoredProject {
    let file: ProjectFile | null;
    try {
      file = this.readProjectFile();
    } catch (error) {
      return { kind: "unreadable", problem: messageOf(error) };
    }
    if (file == null) return { kind: "missing" };
    if (this.heldProjectId != null && file.identity.id !== this.heldProjectId) {
      return { kind: "unreadable", problem: `${this.traits.name} now holds another project.` };
    }
    return { kind: "readable", address: file.address };
  }

  /** The history in the state directory; null when there is none or it cannot be read, so there is nothing to compare with. */
  private storedHistory(): ProjectHistory | null {
    try {
      const source = readIfPresent(this.historyPath());
      return source == null ? null : parseHistory(JSON.parse(source));
    } catch {
      return null;
    }
  }

  private currentOutsideChange(): OutsideChange | null {
    return storedProjectChange(this.storedProject(), this.storedHistory());
  }

  private historyPath(): string {
    return join(this.stateDirectory, "history.json");
  }

  private piecePath(address: Address): string {
    return join(this.stateDirectory, "objects", address.slice(0, 2), address.slice(2));
  }

  private writeHistory(history: ProjectHistory): void {
    writeAtomically(this.historyPath(), serializeCanonical(history));
  }

  /**
   * Write a project, its pieces and its history, in the order that never
   * leaves a record naming what is not stored. A project file changed
   * outside Requireganizer is replaced only when the spec owner chose it,
   * or when it already holds the state written, which loses nothing.
   */
  private store(write: ProjectWrite): void {
    const stored = this.storedProject();
    const holdsWritten = stored.kind === "readable" && stored.address === write.address;
    if (!write.overOutsideChange && !holdsWritten && storedProjectChange(stored, this.storedHistory()) != null) {
      this.checkOutsideChange();
      throw new UserFacingError(
        `${this.traits.name} changed outside Requireganizer, so it was not overwritten. Choose in Requireganizer which project to keep.`,
      );
    }
    try {
      for (const [address, bytes] of write.pieces) {
        const path = this.piecePath(address);
        if (!existsSync(path)) writeAtomically(path, bytes);
      }
      this.writeHistory(write.writing);
      const document = projectDocument(write.state);
      const contents = serializeCanonical({ ...document, ...write.project });
      writeAtomically(this.projectFile, contents);
      this.heldProjectId = write.project.id;
      this.lastRead = {
        source: contents,
        file: { identity: write.project, document: { ...document }, address: write.address },
      };
      this.writeHistory(write.written);
    } catch (error) {
      throw new ProjectStorageError(PROJECT_SAVE_ERROR_MESSAGE, error);
    } finally {
      if (this.outsideChangeListeners.size > 0 && this.fileWatcher == null) this.watchProjectFile();
      this.checkOutsideChange();
    }
  }

  private otherProjectMessage(): string {
    return `This server serves the project in ${this.traits.name} only.`;
  }

  readonly outsideChanges: OutsideChanges = {
    watch: (listener) => {
      this.outsideChangeListeners.add(listener);
      if (this.fileWatcher == null) this.watchProjectFile();
      this.checkOutsideChange();
      listener(this.reportedOutsideChange);
      return () => {
        this.outsideChangeListeners.delete(listener);
        if (this.outsideChangeListeners.size > 0) return;
        this.fileWatcher?.close();
        this.fileWatcher = null;
        if (this.outsideChangeCheck != null) clearTimeout(this.outsideChangeCheck);
        this.outsideChangeCheck = null;
      };
    },
  };

  private watchProjectFile(): void {
    const name = basename(this.projectFile);
    try {
      // The folder, not the file: a checkout replaces the file, and a
      // watcher of the file would stop at the first replacement.
      this.fileWatcher = watch(dirname(this.projectFile), { persistent: false }, (_event, changed) => {
        if (changed != null && changed !== name) return;
        if (this.outsideChangeCheck != null) return;
        this.outsideChangeCheck = setTimeout(() => {
          this.outsideChangeCheck = null;
          this.checkOutsideChange();
        }, OUTSIDE_CHANGE_SETTLE_MS);
      });
    } catch (error) {
      // Writes still refuse to replace a changed file; it is noticed then.
      console.error(`Could not watch ${this.traits.name} for changes made outside Requireganizer.`, error);
      return;
    }
    const watcher = this.fileWatcher;
    watcher.on("error", (error) => {
      console.error(`Stopped watching ${this.traits.name} for changes made outside Requireganizer.`, error);
      watcher.close();
      // Watched again at the next write.
      if (this.fileWatcher === watcher) this.fileWatcher = null;
    });
  }

  /** Tell the watchers when the project file's outside change has changed. */
  private checkOutsideChange(): void {
    if (this.outsideChangeListeners.size === 0) return;
    const change = this.currentOutsideChange();
    if (JSON.stringify(change) === JSON.stringify(this.reportedOutsideChange)) return;
    this.reportedOutsideChange = change;
    for (const listener of [...this.outsideChangeListeners]) listener(change);
  }

  /** When the project file last changed; now when that cannot be read, such as for a file removed meanwhile. */
  private modifiedAt(): Date {
    try {
      return statSync(this.projectFile).mtime;
    } catch {
      return this.now();
    }
  }

  readonly projects: ProjectPersistence = {
    list: async () => {
      try {
        const stored = this.readProjectFile();
        return stored == null ? [] : [this.metaOf(stored.identity)];
      } catch {
        // The project still opens, and loading it explains what is wrong.
        return [this.metaOf({ id: DEFAULT_FILE_PROJECT_ID, name: this.defaultName() })];
      }
    },
    load: async (projectId) => {
      // Only the project's authority loads it; from then on this adapter
      // serves that project, and a file holding another is a change.
      this.heldProjectId ??= projectId;
      const stored = this.readProjectFile();
      if (stored == null) return null;
      if (stored.identity.id !== this.heldProjectId) throw new UserFacingError(this.otherProjectMessage());
      return stored.document;
    },
    create: async (write) => {
      if (this.storedProject().kind !== "missing") {
        throw new ProjectStorageError(`${this.traits.name} already holds a project. Import into it from the open project instead.`);
      }
      this.store(write);
    },
    write: async (write) => {
      this.store(write);
    },
    delete: async () => {
      throw new ProjectStorageError(`${PROJECT_DELETE_ERROR_MESSAGE} Delete ${this.traits.name} yourself to remove it.`);
    },
  };

  readonly history: HistoryPersistence = {
    load: async () => {
      const source = readIfPresent(this.historyPath());
      return source == null ? null : parseHistory(JSON.parse(source));
    },
    pieceAddresses: async () => {
      const objects = join(this.stateDirectory, "objects");
      if (!existsSync(objects)) return [];
      return readdirSync(objects).flatMap((prefix) =>
        readdirSync(join(objects, prefix))
          .filter((rest) => !rest.endsWith(".tmp"))
          .map((rest) => `${prefix}${rest}`),
      );
    },
    readPiece: async (_projectId, address) => readIfPresent(this.piecePath(address)),
    deletePieces: async (_projectId, addresses) => {
      for (const address of addresses) rmSync(this.piecePath(address), { force: true });
    },
  };
}
