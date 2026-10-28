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
import { moduleScopeId, parseProjectPayload } from "lib/moduleSchema";
import {
  parseTimelineData,
  PROJECT_DELETE_ERROR_MESSAGE,
  ProjectStorageError,
  type ProjectMeta,
} from "lib/projectStorage";
import {
  compareProviderCallsOldestFirst,
  PROVIDER_CALL_LOAD_ERROR_MESSAGE,
  PROVIDER_CALL_SAVE_ERROR_MESSAGE,
  ProviderCallStorageError,
  type StoredProviderCall,
  toProviderCall,
  toStoredProviderCall,
} from "lib/providerCallStorage";
import {
  createRevisionSnapshot,
  type ProjectRevisionSnapshot,
  REVISION_SNAPSHOT_LOAD_ERROR_MESSAGE,
  REVISION_SNAPSHOT_MISSING_MESSAGE,
  snapshotIdsToPrune,
  sortRevisionSnapshotsNewestFirst,
} from "lib/revisionStorage";
import type {
  OutsideChange,
  OutsideChanges,
  PersistenceAdapter,
  ProjectPersistence,
  ProviderCallPersistence,
  RevisionPersistence,
  StorageTraits,
  TimelinePersistence,
} from "persistence";
import { createModuleStore } from "store";

/** The id of a project file that names none, such as an export placed by hand. */
export const DEFAULT_FILE_PROJECT_ID = "project";

/** The project's identity, stored ahead of its payload. Its update time is the file's own. */
const META_KEYS = ["id", "name", "description"] as const;

interface ProjectFile {
  meta: ProjectMeta;
  /** The registry and module snapshots; null until the project is first saved. */
  payload: Record<string, unknown> | null;
}

export interface FilePersistenceAdapterOptions {
  /** The project file, usually inside the repository it describes. */
  projectFile: string;
  /** Where the project's history lives: timelines, revisions, provider calls. */
  stateDirectory: string;
  now?: () => Date;
  createRevisionSnapshotId?: () => string;
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

/** An id as one file name: it never names a folder or steps out of one. */
function pathSegment(value: string): string {
  return encodeURIComponent(value).replace(/^\.{1,2}$/, (dots) => "%2E".repeat(dots.length));
}

/**
 * A `PersistenceAdapter` that keeps one project in a file a person can read,
 * diff, and commit: the project's id, name, and description followed by the
 * registry and module snapshots, in the same shape a JSON export has, so the
 * file can also be imported elsewhere. The project's history (module
 * timelines, revision snapshots, provider calls) lives in a separate state
 * directory, since it is local work rather than part of the project.
 *
 * Writes are issued synchronously and replace files atomically, so they are
 * never reordered. A project file that cannot be read is never overwritten:
 * loading it fails with what is wrong, and writes to it are refused. Neither
 * is a file changed since this adapter last adopted or wrote it, such as by a
 * checkout; `outsideChanges` reports such a change as it happens.
 */
export class FilePersistenceAdapter implements PersistenceAdapter {
  readonly traits: StorageTraits;
  private readonly projectFile: string;
  private readonly stateDirectory: string;
  private readonly now: () => Date;
  private readonly createRevisionSnapshotId: () => string;
  /**
   * The project file's contents as this adapter last adopted or wrote them;
   * undefined until it has done either. A write over anything else would
   * replace a change made outside the server.
   */
  private knownContents: string | null | undefined = undefined;
  /** The project those contents hold; kept when the file is removed, so writing it again keeps its name. */
  private heldMeta: ProjectMeta | null = null;
  private readonly outsideChangeListeners = new Set<(change: OutsideChange | null) => void>();
  private reportedOutsideChange: OutsideChange | null = null;
  private fileWatcher: FSWatcher | null = null;
  private outsideChangeCheck: ReturnType<typeof setTimeout> | null = null;

  constructor(options: FilePersistenceAdapterOptions) {
    this.projectFile = options.projectFile;
    this.stateDirectory = options.stateDirectory;
    this.now = options.now ?? (() => new Date());
    this.createRevisionSnapshotId =
      options.createRevisionSnapshotId ?? (() => crypto.randomUUID());
    this.traits = { singleProject: true, name: basename(this.projectFile) };
  }

  /** The project file as stored, or null when there is none; throws what makes it unreadable. */
  readProjectFile(): ProjectFile | null {
    return this.parseProjectFile(readIfPresent(this.projectFile));
  }

  private parseProjectFile(source: string | null): ProjectFile | null {
    if (source == null) return null;
    const label = this.traits.name;
    let value: Record<string, unknown>;
    try {
      value = parseJsonObject(source, label);
    } catch (error) {
      throw new UserFacingError(
        `${label} could not be read: ${error instanceof Error ? error.message : String(error)} Fix the file, then try again.`,
      );
    }
    const payload: Record<string, unknown> = { ...value };
    for (const key of META_KEYS) delete payload[key];
    const hasPayload = Object.keys(payload).length > 0;
    if (hasPayload) {
      try {
        const parsed = parseProjectPayload(payload);
        // Every module passes the store's own validation here, so the
        // session never falls back to a blank project over this file.
        for (const entry of parsed.modules) createModuleStore(entry.snapshot);
      } catch (error) {
        throw new UserFacingError(
          `${label} does not hold a valid project: ${error instanceof Error ? error.message : String(error)} Fix the file, then try again.`,
        );
      }
    }
    const text = (key: string): string | null =>
      typeof value[key] === "string" && (value[key] as string).trim().length > 0
        ? (value[key] as string)
        : null;
    return {
      meta: {
        id: text("id") ?? DEFAULT_FILE_PROJECT_ID,
        name: text("name") ?? basename(label, extname(label)),
        description: text("description") ?? "",
        updatedAt: this.modifiedAt().toISOString(),
      },
      payload: hasPayload ? payload : null,
    };
  }

  private writeProjectFile(meta: ProjectMeta, payload: unknown, message: string): void {
    if (payload != null && !isRecord(payload)) throw new ProjectStorageError(message);
    let contents: string;
    try {
      contents = `${JSON.stringify(
        {
          id: meta.id,
          name: meta.name,
          description: meta.description,
          ...(payload as Record<string, unknown> | null),
        },
        null,
        2,
      )}\n`;
    } catch (error) {
      throw new ProjectStorageError(message, error);
    }
    try {
      writeAtomically(this.projectFile, contents);
    } catch (error) {
      throw new ProjectStorageError(message, error);
    }
    this.remember(contents, meta);
  }

  /** Record the project file's contents as this adapter adopted or wrote them. */
  private remember(contents: string | null, meta: ProjectMeta | null): void {
    this.knownContents = contents;
    if (meta != null) this.heldMeta = meta;
    if (this.outsideChangeListeners.size > 0 && this.fileWatcher == null) this.watchProjectFile();
    this.checkOutsideChange();
  }

  /** The stored project, read for a write; a write never replaces a file it cannot read. */
  private projectForWrite(message: string): ProjectFile | null {
    let source: string | null;
    try {
      source = readIfPresent(this.projectFile);
    } catch (error) {
      throw new ProjectStorageError(message, error);
    }
    if (this.knownContents !== undefined && source !== this.knownContents) {
      this.checkOutsideChange();
      throw new UserFacingError(
        `${this.traits.name} changed outside Requireganizer, so it was not overwritten. Choose in Requireganizer which version to keep.`,
      );
    }
    try {
      return this.parseProjectFile(source);
    } catch (error) {
      throw new ProjectStorageError(
        error instanceof Error ? error.message : message,
        error,
      );
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
    adoptStored: () => {
      let stored: ProjectFile | null;
      let source: string | null;
      try {
        source = readIfPresent(this.projectFile);
        stored = this.parseProjectFile(source);
      } catch {
        // A file that cannot be read is never overwritten.
        return false;
      }
      if (stored != null && this.heldMeta != null && stored.meta.id !== this.heldMeta.id) return false;
      this.remember(source, stored?.meta ?? null);
      return true;
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
      // Watched again at the next write or adoption.
      if (this.fileWatcher === watcher) this.fileWatcher = null;
    });
  }

  /** Tell the watchers when the project file's difference from what this adapter holds has changed. */
  private checkOutsideChange(): void {
    if (this.outsideChangeListeners.size === 0) return;
    const change = this.currentOutsideChange();
    if (JSON.stringify(change) === JSON.stringify(this.reportedOutsideChange)) return;
    this.reportedOutsideChange = change;
    for (const listener of [...this.outsideChangeListeners]) listener(change);
  }

  private currentOutsideChange(): OutsideChange | null {
    const known = this.knownContents;
    if (known === undefined) return null;
    let source: string | null;
    try {
      source = readIfPresent(this.projectFile);
    } catch (error) {
      return { kind: "changed", problem: messageOf(error) };
    }
    if (source === known) return null;
    if (source == null) return { kind: "removed" };
    let changedId: string;
    try {
      changedId = this.parseProjectFile(source)!.meta.id;
    } catch (error) {
      return { kind: "changed", problem: messageOf(error) };
    }
    if (this.heldMeta != null && changedId !== this.heldMeta.id) {
      return { kind: "changed", problem: `${this.traits.name} now holds another project.` };
    }
    return { kind: "changed", problem: null };
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
        return stored == null ? [] : [stored.meta];
      } catch {
        // The project still opens, and loading it explains what is wrong.
        return [
          {
            id: DEFAULT_FILE_PROJECT_ID,
            name: basename(this.traits.name, extname(this.traits.name)),
            description: "",
            updatedAt: this.modifiedAt().toISOString(),
          },
        ];
      }
    },
    saveIndex: async (projects) => {
      const message = "Could not save the project.";
      const stored = this.projectForWrite(message);
      if (projects.length === 0) {
        if (stored != null) throw new ProjectStorageError(`Delete ${this.traits.name} yourself to remove the project.`);
        return;
      }
      const [meta, ...others] = projects;
      if (others.length > 0 || (stored != null && stored.meta.id !== meta!.id)) {
        throw new ProjectStorageError(this.otherProjectMessage());
      }
      this.writeProjectFile(meta!, stored?.payload ?? null, message);
    },
    load: async (projectId) => {
      const source = readIfPresent(this.projectFile);
      const stored = this.parseProjectFile(source);
      // A load, such as a page reading the project, never changes what this
      // adapter holds: only `adoptStored` and writes do.
      if (stored == null) return null;
      if (stored.meta.id !== projectId) throw new UserFacingError(this.otherProjectMessage());
      return stored.payload;
    },
    save: async (projectId, data, indexUpdate) => {
      const message = "Could not save the project.";
      const stored = this.projectForWrite(message);
      if (stored != null && stored.meta.id !== projectId) {
        throw new ProjectStorageError(this.otherProjectMessage());
      }
      const meta: ProjectMeta = stored?.meta ?? this.heldMeta ?? {
        id: projectId,
        name: basename(this.traits.name, extname(this.traits.name)),
        description: "",
        updatedAt: this.now().toISOString(),
      };
      this.writeProjectFile({ ...meta, ...indexUpdate }, data, message);
    },
    saveBundle: async (projectId, data, projects) => {
      const message = "Could not save the imported project.";
      const stored = this.projectForWrite(message);
      if (stored != null && (stored.meta.id !== projectId || stored.payload != null)) {
        throw new ProjectStorageError(
          `${this.traits.name} already holds a project. Import into it from the open project instead.`,
        );
      }
      const meta = projects.find((project) => project.id === projectId);
      if (meta == null) throw new ProjectStorageError(message);
      this.writeProjectFile(meta, data, message);
    },
    delete: async () => {
      throw new ProjectStorageError(
        `${PROJECT_DELETE_ERROR_MESSAGE} Delete ${this.traits.name} yourself to remove it.`,
      );
    },
  };

  private timelinePath(projectId: string, moduleId: string): string {
    return join(this.stateDirectory, "timelines", pathSegment(projectId), `${pathSegment(moduleId)}.json`);
  }

  readonly timelines: TimelinePersistence = {
    load: async (projectId, moduleId) =>
      parseTimelineData(readIfPresent(this.timelinePath(projectId, moduleId))),
    save: async (projectId, moduleId, data) => {
      try {
        const source = JSON.stringify(data);
        writeAtomically(this.timelinePath(projectId, moduleId), source === undefined ? "undefined" : source);
        return true;
      } catch {
        // The timeline trims its history and retries on a refused write.
        return false;
      }
    },
  };

  private revisionDirectory(): string {
    return join(this.stateDirectory, "revisions");
  }

  private revisionPath(snapshotId: string): string {
    return join(this.revisionDirectory(), `${pathSegment(snapshotId)}.json`);
  }

  private readRevisions(): ProjectRevisionSnapshot[] {
    if (!existsSync(this.revisionDirectory())) return [];
    return readdirSync(this.revisionDirectory())
      .filter((file) => file.endsWith(".json"))
      .flatMap((file) => {
        try {
          return [JSON.parse(readFileSync(join(this.revisionDirectory(), file), "utf8")) as ProjectRevisionSnapshot];
        } catch (error) {
          // One damaged snapshot hides only itself.
          console.error(`Revision snapshot ${file} could not be read.`, error);
          return [];
        }
      });
  }

  private revisionsForScope(projectId: string, moduleId: string): ProjectRevisionSnapshot[] {
    const scopeId = moduleScopeId(projectId, moduleId);
    return sortRevisionSnapshotsNewestFirst(
      this.readRevisions().filter((snapshot) => snapshot.scopeId === scopeId),
    );
  }

  readonly revisions: RevisionPersistence = {
    list: async (projectId, moduleId) => {
      try {
        return this.revisionsForScope(projectId, moduleId);
      } catch (error) {
        throw new Error(REVISION_SNAPSHOT_LOAD_ERROR_MESSAGE, { cause: error });
      }
    },
    save: async (projectId, moduleId, data, label, pinned = false) => {
      const snapshot = createRevisionSnapshot({
        projectId,
        moduleId,
        data,
        label,
        pinned,
        id: this.createRevisionSnapshotId(),
        now: this.now(),
      });
      writeAtomically(this.revisionPath(snapshot.id), JSON.stringify(snapshot));
      for (const id of snapshotIdsToPrune(this.revisionsForScope(projectId, moduleId))) {
        rmSync(this.revisionPath(id), { force: true });
      }
      // The caller's copy is separate from the stored one.
      return structuredClone(snapshot);
    },
    setPinned: async (snapshotId, pinned) => {
      const source = readIfPresent(this.revisionPath(snapshotId));
      if (source == null) throw new Error(REVISION_SNAPSHOT_MISSING_MESSAGE);
      const snapshot = JSON.parse(source) as ProjectRevisionSnapshot;
      writeAtomically(this.revisionPath(snapshotId), JSON.stringify({ ...snapshot, pinned }));
    },
    delete: async (snapshotId) => {
      rmSync(this.revisionPath(snapshotId), { force: true });
    },
  };

  private providerCallPath(projectId: string): string {
    return join(this.stateDirectory, "provider-calls", `${pathSegment(projectId)}.json`);
  }

  private readProviderCallRows(projectId: string): StoredProviderCall[] {
    const source = readIfPresent(this.providerCallPath(projectId));
    return source == null ? [] : (JSON.parse(source) as StoredProviderCall[]);
  }

  readonly providerCalls: ProviderCallPersistence = {
    load: async (projectId, moduleId) => {
      let rows: StoredProviderCall[];
      try {
        rows = this.readProviderCallRows(projectId);
      } catch (error) {
        throw new ProviderCallStorageError(PROVIDER_CALL_LOAD_ERROR_MESSAGE, error);
      }
      const scopeId = moduleScopeId(projectId, moduleId);
      return rows
        .filter((row) => row.scopeId === scopeId)
        .map(toProviderCall)
        .sort(compareProviderCallsOldestFirst);
    },
    replace: async (projectId, moduleId, calls) => {
      try {
        const scopeId = moduleScopeId(projectId, moduleId);
        const replacement = new Map<string, StoredProviderCall>();
        for (const call of calls) {
          replacement.set(call.id, toStoredProviderCall(call, projectId, scopeId));
        }
        const kept = this.readProviderCallRows(projectId).filter(
          (row) => row.scopeId !== scopeId && !replacement.has(row.id),
        );
        writeAtomically(
          this.providerCallPath(projectId),
          JSON.stringify([...kept, ...replacement.values()]),
        );
      } catch (error) {
        throw new ProviderCallStorageError(PROVIDER_CALL_SAVE_ERROR_MESSAGE, error);
      }
    },
  };
}
