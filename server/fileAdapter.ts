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
import { isRecord, parseJsonObject } from "lib/json";
import {
  PROJECT_DELETE_ERROR_MESSAGE,
  PROJECT_SAVE_ERROR_MESSAGE,
  type ProjectIdentity,
  type ProjectMeta,
  ProjectStorageError,
} from "lib/projectStorage";
import type {
  OutsideChanges,
  PersistenceAdapter,
  ProjectPersistence,
  ProjectWrite,
  RecordPersistence,
  StorageTraits,
} from "persistence";
import {
  type Address,
  type OutsideChange,
  parseProject,
  parseProjectRecord,
  PieceStore,
  type ProjectRecord,
  projectDocument,
  serializeCanonical,
  serializeCanonicalInSlices,
  type StoredProject,
  storedProjectChange,
} from "storage";

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
  /** Where the project's record and pieces live. */
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

/**
 * What tells one version of a file from another without reading it: any
 * write gives it a new modification time or, replacing it, a new inode.
 * Null when there is no file.
 */
function fingerprintOf(path: string): string | null {
  try {
    const stat = statSync(path, { bigint: true });
    return `${stat.ino} ${stat.size} ${stat.mtimeNs}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
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
 * opens too. The project's record, which holds its history, and its pieces
 * live in a separate state directory, since they are local work rather than
 * part of the project, with the identity of the project last written, so a
 * project file removed outside Requireganizer still opens, from its
 * history, for the spec owner to write back or leave removed.
 *
 * Reads and writes run one after another, in the order they were issued, so
 * a read observes every write issued before it. A write first turns the
 * project into text a slice at a time, so a large project holds no request
 * up; then, at once, it checks for an outside change and replaces files
 * atomically: the pieces first, then the record naming the state being
 * written, then the project file, then the record naming it as written. A
 * file is read again only once it changed since it was last read or written.
 * Whether the project file changed outside Requireganizer, such as by a
 * checkout, is decided by `storedProjectChange` from the file and the
 * record in the state directory: `outsideChanges` reports such a change as
 * it happens, and a write over one is refused unless the spec owner chose it.
 * Requireganizer never removes the project file: deleting the project
 * forgets its record and pieces once the file is gone.
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
  /** The last project file read or written, what it holds and its fingerprint, so an unchanged file is not read again. */
  private lastRead: { source: string; file: ProjectFile; fingerprint: string } | null = null;
  /** The reads and writes under way, one after another, in the order they were issued. */
  private operations: Promise<void> = Promise.resolve();
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
    const fingerprint = fingerprintOf(this.projectFile);
    if (fingerprint == null) return null;
    if (this.lastRead?.fingerprint === fingerprint) return this.lastRead.file;
    return this.parseProjectFile(readIfPresent(this.projectFile), fingerprint);
  }

  private defaultName(): string {
    return basename(this.traits.name, extname(this.traits.name));
  }

  private parseProjectFile(source: string | null, fingerprint: string): ProjectFile | null {
    if (source == null) return null;
    if (this.lastRead?.source === source) {
      this.lastRead = { ...this.lastRead, fingerprint };
      return this.lastRead.file;
    }
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
    this.lastRead = { source, file, fingerprint };
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

  /** The record in the state directory; null when there is none or it cannot be read, so there is nothing to compare with. */
  private storedRecord(): ProjectRecord | null {
    try {
      const source = readIfPresent(this.recordPath());
      return source == null ? null : parseProjectRecord(JSON.parse(source));
    } catch {
      return null;
    }
  }

  private currentOutsideChange(): OutsideChange | null {
    return storedProjectChange(this.storedProject(), this.storedRecord());
  }

  private recordPath(): string {
    return join(this.stateDirectory, "record.json");
  }

  private identityPath(): string {
    return join(this.stateDirectory, "identity.json");
  }

  private objectsPath(): string {
    return join(this.stateDirectory, "objects");
  }

  /**
   * The identity of the project last written; the one a file that names
   * none has when no identity was kept for it.
   */
  private writtenIdentity(): ProjectIdentity {
    const fallback = { id: DEFAULT_FILE_PROJECT_ID, name: this.defaultName() };
    try {
      const source = readIfPresent(this.identityPath());
      const value: unknown = source == null ? null : JSON.parse(source);
      if (isRecord(value) && typeof value.id === "string" && typeof value.name === "string") {
        return { id: value.id, name: value.name };
      }
    } catch {
      // Unreadable: the fallback names it.
    }
    return fallback;
  }

  private piecePath(address: Address): string {
    return join(this.objectsPath(), address.slice(0, 2), address.slice(2));
  }

  private writeRecord(record: ProjectRecord): void {
    writeAtomically(this.recordPath(), serializeCanonical(record));
  }

  /**
   * Write a project, its pieces and its record, in the order that never
   * leaves a record naming what is not stored. A project file changed
   * outside Requireganizer is replaced only when the spec owner chose it,
   * or when it already holds the state written, which loses nothing.
   * `contents` is the project file's text for the write.
   */
  private store(write: ProjectWrite, contents: string): void {
    const stored = this.storedProject();
    const holdsWritten = stored.kind === "readable" && stored.address === write.address;
    if (!write.overOutsideChange && !holdsWritten && storedProjectChange(stored, this.storedRecord()) != null) {
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
      this.writeRecord(write.writing);
      writeAtomically(this.projectFile, contents);
      // Known as written before the watcher hears of it, so the write reads as no outside change.
      this.lastRead = {
        source: contents,
        file: { identity: write.project, document: { ...projectDocument(write.state) }, address: write.address },
        fingerprint: fingerprintOf(this.projectFile)!,
      };
      writeAtomically(this.identityPath(), serializeCanonical({ id: write.project.id, name: write.project.name }));
      this.heldProjectId = write.project.id;
      this.writeRecord(write.written);
    } catch (error) {
      throw new ProjectStorageError(PROJECT_SAVE_ERROR_MESSAGE, error);
    } finally {
      if (this.outsideChangeListeners.size > 0 && this.fileWatcher == null) this.watchProjectFile();
      this.checkOutsideChange();
    }
  }

  /** The project file's text for a write, made a slice at a time. */
  private contentsOf(write: ProjectWrite): Promise<string> {
    return serializeCanonicalInSlices({ ...projectDocument(write.state), ...write.project });
  }

  /** Run a read or write once every one issued before it is done. */
  private queued<Result>(operation: () => Result | Promise<Result>): Promise<Result> {
    const next = this.operations.then(operation);
    this.operations = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
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
    list: () =>
      this.queued(() => {
        let stored: ProjectFile | null;
        try {
          stored = this.readProjectFile();
        } catch {
          // The project still opens, and loading it explains what is wrong.
          return [this.metaOf({ id: DEFAULT_FILE_PROJECT_ID, name: this.defaultName() })];
        }
        if (stored != null) return [this.metaOf(stored.identity)];
        // A project file removed outside Requireganizer still opens, from its
        // history, so the spec owner chooses what becomes of it.
        return storedProjectChange({ kind: "missing" }, this.storedRecord()) == null
          ? []
          : [this.metaOf(this.writtenIdentity())];
      }),
    load: (projectId) =>
      this.queued(() => {
        // Only the project's authority loads it; from then on this adapter
        // serves that project, and a file holding another is a change.
        this.heldProjectId ??= projectId;
        const stored = this.readProjectFile();
        if (stored == null) return null;
        if (stored.identity.id !== this.heldProjectId) throw new UserFacingError(this.otherProjectMessage());
        return stored.document;
      }),
    create: (write) =>
      this.queued(async () => {
        const contents = await this.contentsOf(write);
        if (this.storedProject().kind !== "missing") {
          throw new ProjectStorageError(`${this.traits.name} already holds a project. Import into it from the open project instead.`);
        }
        this.store(write, contents);
      }),
    write: (write) => this.queued(async () => this.store(write, await this.contentsOf(write))),
    delete: () =>
      this.queued(() => {
        if (this.storedProject().kind !== "missing") {
          throw new ProjectStorageError(`${PROJECT_DELETE_ERROR_MESSAGE} Delete ${this.traits.name} yourself to remove it.`);
        }
        try {
          // The record first: once it is gone, nothing reports the removal again.
          rmSync(this.recordPath(), { force: true });
          rmSync(this.identityPath(), { force: true });
          rmSync(this.objectsPath(), { recursive: true, force: true });
        } catch (error) {
          throw new ProjectStorageError(PROJECT_DELETE_ERROR_MESSAGE, error);
        } finally {
          this.checkOutsideChange();
        }
        this.heldProjectId = null;
        this.lastRead = null;
      }),
  };

  readonly record: RecordPersistence = {
    load: () =>
      this.queued(() => {
        const source = readIfPresent(this.recordPath());
        return source == null ? null : parseProjectRecord(JSON.parse(source));
      }),
    pieceAddresses: () =>
      this.queued(() => {
        const objects = this.objectsPath();
        if (!existsSync(objects)) return [];
        return readdirSync(objects).flatMap((prefix) =>
          readdirSync(join(objects, prefix))
            .filter((rest) => !rest.endsWith(".tmp"))
            .map((rest) => `${prefix}${rest}`),
        );
      }),
    readPiece: (_projectId, address) => this.queued(() => readIfPresent(this.piecePath(address))),
    deletePieces: (_projectId, addresses) =>
      this.queued(() => {
        for (const address of addresses) rmSync(this.piecePath(address), { force: true });
      }),
  };
}
