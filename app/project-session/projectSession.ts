import { getSnapshot, onSnapshot } from "mobx-state-tree";

import { getUserFacingErrorMessage, UserFacingError } from "lib/errors";
import {
  assertModuleNameAvailable,
  LEGACY_MODULE_ID,
  normalizeModuleName,
  visibleModules,
} from "lib/moduleSchema";
import { hasProjectName, type ProjectIdentity } from "lib/projectStorage";
import type { OutsideChange, OutsideChanges, PersistenceAdapter } from "persistence";
import {
  type Address,
  type AuthorityClaim,
  type ProjectAuthority,
  buildExport,
  type ChangeKind,
  EMPTY_HISTORY,
  type ExportOptions,
  historyRoots,
  type HistoryStep,
  KEPT_STEPS,
  moduleContentOf,
  type ModuleRegistry,
  type ModuleState,
  parseProject,
  type PieceLevel,
  PieceStore,
  type ProjectHistory,
  projectState,
  type ProjectState,
} from "storage-and-recovery";
import { createModuleStore, Store } from "store";
import { uuid } from "utilities";

import { SiblingModuleStores } from "./siblingStores";

/** Streaming mutates the store every ~80ms; coalesce writes behind this delay. */
export const PROJECT_SAVE_DEBOUNCE_MS = 800;

/** One visible module as the interface sees it. */
export interface ModuleSummary {
  id: string;
  name: string;
  active: boolean;
}

export type ProjectSessionStatus = "idle" | "loading" | "failed" | "elsewhere" | "ready";

/**
 * The session's observable state. The status and the fields it allows move
 * together: an idle session has no project, a loading session has a named
 * project but no registry yet, a failed session names the project it could
 * not load and why, a session whose project another tab holds names it, and
 * a ready session has both a registry and a store to render. A ready project
 * whose stored version changed outside the session names that change until
 * the person chooses which version to keep.
 */
export type ProjectSessionSnapshot =
  | {
      status: "idle";
      activeProject: null;
      persistenceError: null;
      outsideChange: null;
      registry: null;
      store: Store;
    }
  | {
      status: "loading" | "elsewhere";
      activeProject: ProjectIdentity;
      persistenceError: null;
      outsideChange: null;
      registry: null;
      store: Store;
    }
  | {
      status: "failed";
      activeProject: ProjectIdentity;
      persistenceError: string;
      outsideChange: null;
      registry: null;
      store: Store;
    }
  | {
      status: "ready";
      activeProject: ProjectIdentity;
      persistenceError: string | null;
      outsideChange: OutsideChange | null;
      registry: ModuleRegistry;
      store: Store;
    };

/** The store of work not started yet. */
function blankStore(): Store {
  return Store.create({});
}

/** A project nobody has worked on yet: one hidden module, empty. */
function blankProjectState(): ProjectState {
  return {
    modulesEnabled: false,
    modules: [{ id: LEGACY_MODULE_ID, name: LEGACY_MODULE_ID, archivedAt: null, content: moduleContentOf(blankStore()) }],
  };
}

interface PendingOverviewSeed {
  projectId: string;
  seed: string;
}

/** What failed: a project write. */
type PersistenceNoticeSource = "write";

/**
 * Messages for the persistence banner, at most one per source. A success
 * clears only its own source's message, so one failure never hides another.
 */
type PersistenceNotices = Partial<Record<PersistenceNoticeSource, string>>;

/** The order the banner shows its messages in: unsaved work first. */
const NOTICE_ORDER: readonly PersistenceNoticeSource[] = ["write"];

function shownNotice(notices: PersistenceNotices): string | null {
  const messages = NOTICE_ORDER.flatMap((source) => notices[source] ?? []);
  return messages.length === 0 ? null : messages.join(" ");
}

type IdleSessionState = {
  status: "idle";
  store: Store;
};

type LoadingProjectSessionState = {
  status: "loading-project";
  project: ProjectIdentity;
  store: Store;
};

/** The project's load failed; it stays named so the page can offer a retry. */
type FailedProjectSessionState = {
  status: "load-failed";
  project: ProjectIdentity;
  message: string;
  store: Store;
};

/** Another session, such as another browser tab, is the project's authority; this one offers to take it over. */
type HeldElsewhereSessionState = {
  status: "held-elsewhere";
  project: ProjectIdentity;
  store: Store;
};

type ReadySessionState = {
  status: "ready";
  project: ProjectIdentity;
  registry: ModuleRegistry;
  store: Store;
  persistenceNotices: PersistenceNotices;
};

type SessionState =
  | IdleSessionState
  | LoadingProjectSessionState
  | FailedProjectSessionState
  | HeldElsewhereSessionState
  | ReadySessionState;

function projectSaveErrorMessage(storage: string): string {
  return `Changes could not be saved in ${storage}. Export the project to avoid losing work.`;
}
const PROJECT_LOAD_ERROR_MESSAGE = "The project could not be loaded.";

function snapshotOf(state: SessionState, outsideChange: OutsideChange | null): ProjectSessionSnapshot {
  switch (state.status) {
    case "idle":
      return {
        status: "idle",
        activeProject: null,
        persistenceError: null,
        outsideChange: null,
        registry: null,
        store: state.store,
      };
    case "loading-project":
    case "held-elsewhere":
      return {
        status: state.status === "loading-project" ? "loading" : "elsewhere",
        activeProject: state.project,
        persistenceError: null,
        outsideChange: null,
        registry: null,
        store: state.store,
      };
    case "load-failed":
      return {
        status: "failed",
        activeProject: state.project,
        persistenceError: state.message,
        outsideChange: null,
        registry: null,
        store: state.store,
      };
    case "ready":
      return {
        status: "ready",
        activeProject: state.project,
        persistenceError: shownNotice(state.persistenceNotices),
        outsideChange,
        registry: state.registry,
        store: state.store,
      };
  }
}

/** What the last write issued held, so an unchanged project is not written again. */
interface IssuedWrite {
  address: Address;
  lastStep: string | null;
  name: string;
}

/**
 * A project's authority-side session: the live store, the module registry,
 * the history of changes and the pieces of its states, and the pending
 * project write. Framework-free so a later phase can host the same
 * orchestration in a local Node process or a Durable Object. Subscribers
 * observe changes to the session (store, registry, project, persistence
 * error), not every store mutation.
 */
export class ProjectSession {
  readonly persistence: PersistenceAdapter;
  private readonly listeners = new Set<() => void>();
  private readonly siblingStores = new SiblingModuleStores();

  private state: SessionState;
  private snapshot: ProjectSessionSnapshot;
  private pendingOverviewSeed: PendingOverviewSeed | null = null;
  /** The project load in flight, which a repeated selection of it waits for. */
  private projectLoad: Promise<void> = Promise.resolve();

  /**
   * Every operation that replaces what an async load or write would land on
   * starts a new generation: opening or leaving a project, switching, adding
   * or reloading a module, and dispose. Async work captures the generation
   * it started under and drops its result once that moved on.
   */
  private operationGeneration = 0;
  /**
   * The persistence banner reflects the newest project write: an earlier
   * write that settles after a later one never sets or clears it.
   */
  private projectWriteSequence = 0;
  /** The newest write issued, settled either way; giving the project up waits for it. */
  private lastWrite: Promise<void> = Promise.resolve();
  private issued: IssuedWrite | null = null;

  /** The pieces of the open project's kept states. */
  private pieces = new PieceStore();
  /** The pieces storage holds for the open project, as far as this session knows. */
  private storedPieces = new Set<Address>();
  private history: ProjectHistory = EMPTY_HISTORY;
  private nextSequence = 1;
  /** Steps gave way since storage was last cleaned up. */
  private cleanUpDue = false;
  /** A change is running in the gate; writes it asks for wait until its step is recorded. */
  private changing = false;
  private writeAfterChange = false;

  private unsubscribeStore: (() => void) | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly outsideChanges: OutsideChanges | null;
  /** How the stored project differs from the one the session holds. */
  private outsideChange: OutsideChange | null = null;
  private stopWatchingOutsideChanges: (() => void) | null = null;
  /** A project write was held back while an outside change stood. */
  private writeHeldBack = false;

  private readonly authority: ProjectAuthority | null;
  private claim: { projectId: string; held: AuthorityClaim } | null = null;
  /** The claim being made; the next one waits for it, so a session never stands in its own way. */
  private claiming: Promise<void> = Promise.resolve();

  /**
   * `outsideChanges` reports changes made to the stored project by anything
   * else, for a storage that has them. `authority` decides which of several
   * sessions sharing a storage writes a project, for a storage that has
   * several.
   */
  constructor(
    persistence: PersistenceAdapter,
    options: { outsideChanges?: OutsideChanges; authority?: ProjectAuthority } = {},
  ) {
    this.persistence = persistence;
    this.outsideChanges = options.outsideChanges ?? null;
    this.authority = options.authority ?? null;
    this.state = { status: "idle", store: blankStore() };
    this.snapshot = snapshotOf(this.state, this.outsideChange);
  }

  // Public operations are arrow properties: React context passes them to
  // consumers as bare callbacks, where prototype methods would lose `this`.
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): ProjectSessionSnapshot => this.snapshot;

  private beginOperation(): number {
    this.operationGeneration += 1;
    return this.operationGeneration;
  }

  private isOperationCurrent(generation: number): boolean {
    return generation === this.operationGeneration;
  }

  private publish(): void {
    this.snapshot = snapshotOf(this.state, this.outsideChange);
    this.listeners.forEach((listener) => listener());
  }

  /** The state an operation may change, or null while one is refused. */
  private readyState(): ReadySessionState | null {
    return this.state.status === "ready" ? this.state : null;
  }

  /** Set or, with null, clear one source's message. */
  private setPersistenceNotice(source: PersistenceNoticeSource, message: string | null): void {
    const state = this.readyState();
    if (state == null) return;
    if ((state.persistenceNotices[source] ?? null) === message) return;
    const notices = { ...state.persistenceNotices };
    if (message == null) delete notices[source];
    else notices[source] = message;
    this.state = { ...state, persistenceNotices: notices };
    this.publish();
  }

  /** The address of the open project's state now, its pieces held. */
  private addressOf(state: ReadySessionState): Address {
    return this.pieces.addressOf(projectState(state.registry, state.store));
  }

  /**
   * Run one change to the open project, synchronously, and record it as one
   * step when the project's state differs afterwards. Every request that
   * changes the project comes through here. A change inside another is part
   * of it. Refused while the project is not open here, and while an outside
   * change waits for the spec owner's choice, since either version may be
   * the one kept.
   */
  change = <Result>(kind: ChangeKind, run: () => Result): Result => {
    if (this.changing) return run();
    const state = this.readyState();
    if (state == null) {
      throw new UserFacingError(
        this.state.status === "held-elsewhere"
          ? "This project is open in another tab."
          : "The project is not open yet. Try again in a moment.",
      );
    }
    if (this.outsideChange != null) {
      throw new UserFacingError(
        `${this.persistence.traits.name} changed outside Requireganizer. Nothing changes until the spec owner chooses in Requireganizer which version to keep.`,
      );
    }
    const project = state.project.id;
    const before = this.addressOf(state);
    this.changing = true;
    let result: Result;
    try {
      result = run();
    } finally {
      this.changing = false;
      const after = this.readyState();
      if (after != null && after.project.id === project) {
        const address = this.addressOf(after);
        if (address !== before) this.recordStep(kind, before, address);
      }
      if (this.writeAfterChange) {
        this.writeAfterChange = false;
        this.persistProject();
      }
    }
    return result;
  };

  private recordStep(kind: ChangeKind, before: Address, after: Address): void {
    const step: HistoryStep = { id: uuid(), sequence: this.nextSequence, before, after, at: new Date().toISOString(), kind };
    this.nextSequence += 1;
    const steps = [...this.history.steps, step];
    if (steps.length > KEPT_STEPS) {
      steps.splice(0, steps.length - KEPT_STEPS);
      this.cleanUpDue = true;
    }
    this.history = { ...this.history, steps };
    this.scheduleWrite();
  }

  /**
   * Write the open project, the pieces its history names and the history.
   * This is the only code that writes the stored project; the adapter keeps
   * the order that never leaves a record naming what is not stored.
   */
  private persistProject(): void {
    const state = this.readyState();
    if (state == null) return;
    if (this.changing) {
      this.writeAfterChange = true;
      return;
    }
    // Written once the person has chosen which version to keep. Storage
    // would refuse it, and the refusal could arrive after the choice.
    if (this.outsideChange != null) {
      this.writeHeldBack = true;
      return;
    }
    const current = projectState(state.registry, state.store);
    const address = this.pieces.addressOf(current);
    const issued: IssuedWrite = { address, lastStep: this.history.steps.at(-1)?.id ?? null, name: state.project.name };
    if (
      this.issued != null &&
      this.issued.address === issued.address &&
      this.issued.lastStep === issued.lastStep &&
      this.issued.name === issued.name
    ) {
      return;
    }
    this.issued = issued;
    const history = this.history;
    const pieces = [...this.pieces.reachable([address, ...historyRoots(history)])]
      .filter((piece) => !this.storedPieces.has(piece))
      .map((piece) => [piece, this.pieces.get(piece)!.bytes] as const);
    for (const [piece] of pieces) this.storedPieces.add(piece);
    this.history = { ...history, writing: address };
    const sequence = ++this.projectWriteSequence;
    const isLatest = (): boolean => sequence === this.projectWriteSequence;
    const generation = this.operationGeneration;
    const projectId = state.project.id;

    this.lastWrite = this.persistence.projects
      .write({
        project: state.project,
        state: current,
        address,
        pieces,
        writing: { steps: history.steps, lastWritten: history.lastWritten, writing: address },
        written: { steps: history.steps, lastWritten: address, writing: null },
      })
      .then(
        () => {
          if (this.readyState()?.project.id !== projectId) return;
          this.history = { ...this.history, lastWritten: address, writing: this.history.writing === address ? null : this.history.writing };
          if (!isLatest()) return;
          this.setPersistenceNotice("write", null);
          if (this.cleanUpDue) void this.cleanUp(projectId, generation);
        },
        (error: unknown) => {
          for (const [piece] of pieces) this.storedPieces.delete(piece);
          if (isLatest()) this.issued = null;
          // Refused because the stored project changed meanwhile: the
          // person's choice of version settles it.
          if (this.outsideChange != null) {
            this.writeHeldBack = true;
            return;
          }
          console.error("Could not persist project changes.", error);
          if (!isLatest()) return;
          this.setPersistenceNotice(
            "write",
            getUserFacingErrorMessage(error, projectSaveErrorMessage(this.persistence.traits.name)),
          );
        },
      );
  }

  private scheduleWrite(): void {
    if (this.saveTimer != null) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.persistProject();
    }, PROJECT_SAVE_DEBOUNCE_MS);
  }

  /** Write now what waits for the debounce. */
  private flushPendingWrites(): void {
    if (this.saveTimer == null) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.persistProject();
  }

  private attachStoreSubscription(state: ReadySessionState): void {
    this.unsubscribeStore?.();
    this.unsubscribeStore = onSnapshot(state.store, () => this.scheduleWrite());
  }

  /** Stop following the store. Unsaved changes are written first, unless the project is no longer this session's to write. */
  private detachStoreSubscription(options: { write: boolean } = { write: true }): void {
    this.unsubscribeStore?.();
    this.unsubscribeStore = null;
    if (options.write) {
      this.flushPendingWrites();
    } else if (this.saveTimer != null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
  }

  /**
   * Hold every piece the history keeps, reading from storage those not held
   * yet. Throws when storage cannot be read, so a clean-up never mistakes an
   * unreadable piece for one nothing needs.
   */
  private async holdKeptPieces(projectId: string, generation: number): Promise<void> {
    const visited = new Set<Address>();
    let pending: (readonly [Address, PieceLevel])[] = historyRoots(this.history).map((root) => [root, "project"] as const);
    while (pending.length > 0 && this.isOperationCurrent(generation)) {
      const batch = pending.filter(([address]) => !visited.has(address));
      pending = [];
      for (const [address] of batch) visited.add(address);
      await Promise.all(
        batch.map(async ([address, level]) => {
          if (!this.pieces.has(address)) {
            const bytes = await this.persistence.history.readPiece(projectId, address);
            if (bytes == null || !this.pieces.adopt(address, bytes, level)) {
              console.error(`The piece ${address} of the project's history is missing or damaged.`);
              return;
            }
          }
          pending.push(...this.pieces.get(address)!.children);
        }),
      );
    }
  }

  /**
   * Mark and sweep: keep the pieces of every kept step, of the states last
   * written and being written, and of the open project, and delete every
   * other piece, in memory and in storage. One session is the project's
   * authority, so nothing else adds pieces meanwhile.
   */
  private async cleanUp(projectId: string, generation: number): Promise<void> {
    this.cleanUpDue = false;
    try {
      await this.holdKeptPieces(projectId, generation);
      const state = this.readyState();
      if (!this.isOperationCurrent(generation) || state == null || state.project.id !== projectId) return;
      const kept = this.pieces.reachable([this.addressOf(state), ...historyRoots(this.history)]);
      const unneeded = [...this.storedPieces].filter((address) => !kept.has(address));
      this.pieces.retainOnly(kept);
      for (const address of unneeded) this.storedPieces.delete(address);
      if (unneeded.length > 0) await this.persistence.history.deletePieces(projectId, unneeded);
    } catch (error) {
      console.error("Could not clean up the project's history.", error);
    }
  }

  /** Hold the project for this session, when sessions share its storage. False while another holds it. */
  private async claimProject(projectId: string, takeOver: boolean): Promise<boolean> {
    const authority = this.authority;
    if (authority == null) return true;
    const previous = this.claiming;
    let settled!: () => void;
    this.claiming = new Promise((resolve) => {
      settled = resolve;
    });
    try {
      await previous;
      if (this.claim?.projectId === projectId) return true;
      this.releaseClaim();
      const held = await authority.claim(projectId, { takeOver });
      if (held == null) return false;
      this.claim = { projectId, held };
      held.onEnd((asked) => this.claimEnded(projectId, asked));
      return true;
    } finally {
      settled();
    }
  }

  private releaseClaim(): void {
    this.claim?.held.release();
    this.claim = null;
  }

  /**
   * Another session took the project. Asked first, this one writes what it
   * has not written yet and waits for it; taken outright, it writes nothing
   * more, since the project is no longer its to write.
   */
  private async claimEnded(projectId: string, asked: boolean): Promise<void> {
    if (this.claim?.projectId !== projectId) return;
    this.claim = null;
    if (asked) {
      this.flushPendingWrites();
      await this.lastWrite;
    }
    const state = this.state;
    if (!("project" in state) || state.project.id !== projectId) return;
    this.beginOperation();
    this.detachStoreSubscription({ write: false });
    this.state = { status: "held-elsewhere", project: state.project, store: state.store };
    this.syncModuleContext();
    this.publish();
  }

  /** Link the shown store to the open project's other modules, so dependencies on their items resolve. */
  private syncModuleContext(): void {
    const state = this.state;
    this.siblingStores.applyModuleContext(state.store, state.status === "ready" ? state.registry : null);
  }

  /**
   * Restart whatever `dispose` cancelled: a project load, or following the
   * store of the open project.
   */
  start = (): void => {
    if (this.outsideChanges != null && this.stopWatchingOutsideChanges == null) {
      this.stopWatchingOutsideChanges = this.outsideChanges.watch((change) =>
        this.outsideChangeObserved(change),
      );
    }
    const state = this.state;
    switch (state.status) {
      case "idle":
        void this.openOnlyProject();
        return;
      case "load-failed":
      case "held-elsewhere":
        return;
      case "loading-project":
        void this.openProject(state.project);
        return;
      case "ready":
        if (this.unsubscribeStore == null) this.attachStoreSubscription(state);
    }
  };

  /**
   * Stop autosave after issuing every pending write. Safe to call repeatedly. A later `start` resumes what this
   * cancelled.
   */
  dispose = (): void => {
    if (this.writeHeldBack) {
      console.error(
        `${this.persistence.traits.name} changed outside Requireganizer, so the changes made since were not saved.`,
      );
    }
    this.stopWatchingOutsideChanges?.();
    this.stopWatchingOutsideChanges = null;
    this.beginOperation();
    this.detachStoreSubscription();
  };

  /** Show a store and registry and persist them. */
  private showStore(project: ProjectIdentity, store: Store, registry: ModuleRegistry): void {
    const previous = this.readyState();
    this.detachStoreSubscription();
    const state: ReadySessionState = {
      status: "ready",
      project,
      registry,
      store,
      persistenceNotices: previous?.project.id === project.id ? previous.persistenceNotices : {},
    };
    this.state = state;
    this.attachStoreSubscription(state);
    this.persistProject();
    this.syncModuleContext();
    this.publish();
  }

  /** Registry-only changes persist immediately; store mutations stay debounced. */
  private commitRegistry(nextRegistry: ModuleRegistry): void {
    const state = this.readyState();
    if (state == null) return;
    this.state = { ...state, registry: nextRegistry };
    this.persistProject();
    this.syncModuleContext();
    this.publish();
  }

  /** The registry with the shown store's content written into its entry. */
  private stashActiveModule(state: ReadySessionState): ModuleRegistry {
    return { ...projectState(state.registry, state.store), activeModuleId: state.registry.activeModuleId };
  }

  /** Show a project's state, opening its first visible module. */
  private showProjectState(project: ProjectIdentity, opened: ProjectState): void {
    const first = visibleModules(opened)[0]!;
    this.showStore(project, createModuleStore(first.content), { ...opened, activeModuleId: first.id });
  }

  /** Leave whatever is shown and load a project from storage. */
  private openProject(project: ProjectIdentity, options: { takeOver: boolean } = { takeOver: false }): Promise<void> {
    // Finish the outgoing writes before anything is replaced.
    this.flushPendingWrites();
    // The project is read again, so a write held back has nothing to keep.
    this.writeHeldBack = false;
    const generation = this.beginOperation();
    this.detachStoreSubscription();
    if (this.claim != null && this.claim.projectId !== project.id) this.releaseClaim();
    this.state = { status: "loading-project", project, store: this.state.store };
    this.publish();
    this.projectLoad = this.loadProject(project, generation, options.takeOver);
    return this.projectLoad;
  }

  /**
   * Load a project and its history, then show the store. A superseded load
   * is dropped after each await; a failed load ends failed, naming the
   * project, instead of leaving the session loading. Stored data that
   * cannot be read is never replaced.
   */
  private async loadProject(project: ProjectIdentity, generation: number, takeOver: boolean): Promise<void> {
    try {
      const claimed = await this.claimProject(project.id, takeOver);
      if (!this.isOperationCurrent(generation)) {
        // Left meanwhile, such as back to the projects: the claim goes too.
        const current = this.state;
        if ((!("project" in current) || current.project.id !== project.id) && this.claim?.projectId === project.id) {
          this.releaseClaim();
        }
        return;
      }
      if (!claimed) {
        this.state = { status: "held-elsewhere", project, store: this.state.store };
        this.publish();
        return;
      }
      // The session holds the project it opens: writes may replace it.
      this.outsideChanges?.adoptStored();
      const document = await this.persistence.projects.load(project.id);
      if (!this.isOperationCurrent(generation)) return;
      if (document == null) throw new UserFacingError(`${project.name} is no longer stored.`);
      let opened: ProjectState;
      try {
        opened = parseProject(document);
      } catch (error) {
        throw new UserFacingError(
          `${project.name} could not be opened because its stored data is invalid: ${error instanceof Error ? error.message : String(error)} It was left unchanged.`,
          error,
        );
      }
      const history = await this.persistence.history.load(project.id).catch((error: unknown) => {
        console.error("The project's history could not be read; it starts again.", error);
        return null;
      });
      const stored = await this.persistence.history.pieceAddresses(project.id);
      if (!this.isOperationCurrent(generation)) return;
      this.pieces = new PieceStore();
      this.storedPieces = new Set(stored);
      this.history = history ?? EMPTY_HISTORY;
      this.nextSequence = Math.max(0, ...this.history.steps.map(({ sequence }) => sequence)) + 1;
      // A project stored as its history last wrote it is not written again on opening.
      this.issued =
        this.history.lastWritten == null || this.history.writing != null
          ? null
          : { address: this.history.lastWritten, lastStep: this.history.steps.at(-1)?.id ?? null, name: project.name };
      this.showProjectState(project, opened);
      void this.cleanUp(project.id, generation);
    } catch (error) {
      if (!this.isOperationCurrent(generation)) return;
      console.error("Could not load the project.", error);
      this.detachStoreSubscription();
      this.state = {
        status: "load-failed",
        project,
        message: getUserFacingErrorMessage(error, PROJECT_LOAD_ERROR_MESSAGE),
        store: this.state.store,
      };
      this.syncModuleContext();
      this.publish();
    }
  }

  /** Show another module of the open project. */
  private showModule(state: ReadySessionState, store: Store, registry: ModuleRegistry): void {
    this.beginOperation();
    this.showStore(state.project, store, registry);
  }

  /** Flush everything the tab would otherwise lose, e.g. on unload. */
  flush = (): void => {
    this.flushPendingWrites();
  };

  /** Rebuild the store from its own snapshot, e.g. after a code reload. */
  reloadStore = (): void => {
    const state = this.state;
    const created = Store.create(getSnapshot(state.store));
    if (state.status !== "ready") {
      this.state = { ...state, store: created };
      this.publish();
      return;
    }
    this.showModule(state, created, state.registry);
  };

  consumeOverviewSeed = (projectId: string): string | null => {
    const pending = this.pendingOverviewSeed;
    if (pending == null || pending.projectId !== projectId) return null;
    this.pendingOverviewSeed = null;
    return pending.seed;
  };

  selectProject = (
    id: string,
    name: string,
    options?: { overviewSeed?: string },
  ): Promise<void> => {
    // A pending seed stays until a new one replaces it, the user leaves, or
    // another project opens.
    const seed = options?.overviewSeed?.trim();
    if (seed != null && seed.length > 0) {
      this.pendingOverviewSeed = { projectId: id, seed };
    } else if (this.pendingOverviewSeed?.projectId !== id) {
      this.pendingOverviewSeed = null;
    }
    // Clients share the session: selecting the project already open or
    // opening keeps it, rather than reloading it under another client.
    const state = this.state;
    if ((state.status === "loading-project" || state.status === "ready") && state.project.id === id) {
      return this.projectLoad;
    }
    return this.openProject({ id, name });
  };

  /** Open the project another session holds here, once that one has written what it had. */
  takeOverProject = (): Promise<void> => {
    const state = this.state;
    if (state.status !== "held-elsewhere") return Promise.resolve();
    return this.openProject(state.project, { takeOver: true });
  };

  /**
   * A storage that holds one project has nothing to choose from: its project
   * opens. Settles once the project is open or has failed to load, or at
   * once when the storage holds several projects or none.
   */
  openOnlyProject = async (): Promise<void> => {
    if (!this.persistence.traits.singleProject) return;
    const state = this.state;
    if (state.status !== "idle") {
      if (state.status === "loading-project") await this.projectLoad;
      return;
    }
    const projects = await this.persistence.projects.list();
    // Another client opened a project while the list was read.
    if (this.state.status !== "idle") return this.openOnlyProject();
    if (projects.length !== 1) return;
    await this.selectProject(projects[0]!.id, projects[0]!.name);
  };

  private outsideChangeObserved(change: OutsideChange | null): void {
    this.outsideChange = change;
    // The stored project is again the one the session holds, such as after
    // a checkout back: what was held back is written now.
    if (change == null && this.writeHeldBack) {
      this.writeHeldBack = false;
      this.issued = null;
      this.persistProject();
    }
    this.publish();
  }

  /**
   * Open the project as it now is in storage, after it changed outside the
   * session.
   */
  openChangedProject = (): Promise<void> => {
    const state = this.choosableState();
    const change = this.outsideChange;
    if (change?.kind !== "changed") return Promise.resolve();
    if (change.problem != null) return Promise.reject(new UserFacingError(change.problem));
    return this.openProject(state.project);
  };

  /** Write the shown project over the stored one that changed outside the session. */
  keepShownProject = (): void => {
    this.choosableState();
    if (this.outsideChange == null) return;
    // The shown version is written as soon as nothing stands in its way:
    // once the stored one is adopted, or once the change is gone.
    this.writeHeldBack = true;
    if (this.outsideChanges?.adoptStored() === false) {
      throw new UserFacingError(
        `${this.persistence.traits.name} cannot be read or holds another project, so it is not replaced. Fix it, then choose again.`,
      );
    }
    if (this.writeHeldBack) {
      this.writeHeldBack = false;
      this.issued = null;
      this.persistProject();
    }
  };

  /** The open project, while the choice between versions can be made. */
  private choosableState(): ReadySessionState {
    const state = this.readyState();
    if (state == null) {
      throw new UserFacingError("Choose which version to keep once the project has finished opening.");
    }
    return state;
  }

  backToProjects = (): void => {
    this.flushPendingWrites();
    this.beginOperation();
    this.pendingOverviewSeed = null;
    this.detachStoreSubscription();
    this.releaseClaim();
    this.state = { status: "idle", store: this.state.store };
    this.syncModuleContext();
    this.publish();
  };

  clearPersistenceError = (): void => {
    const state = this.readyState();
    if (state == null || Object.keys(state.persistenceNotices).length === 0) return;
    this.state = { ...state, persistenceNotices: {} };
    this.publish();
  };

  enableModules = (name: string): void => {
    const current = this.readyState()?.registry;
    if (current == null || current.modulesEnabled) return;
    const trimmed = normalizeModuleName(name);
    assertModuleNameAvailable(trimmed, current.modules);
    this.commitRegistry({
      ...current,
      modulesEnabled: true,
      modules: current.modules.map((entry) =>
        entry.id === current.activeModuleId ? { ...entry, name: trimmed } : entry,
      ),
    });
  };

  switchModule = (id: string): boolean => {
    const state = this.readyState();
    if (state == null) return false;
    const current = state.registry;
    if (id === current.activeModuleId) return true;
    const target = current.modules.find((entry) => entry.id === id);
    if (target == null || target.archivedAt != null) return false;
    this.showModule(state, createModuleStore(target.content), { ...this.stashActiveModule(state), activeModuleId: id });
    return true;
  };

  addModule = (name: string): void => {
    const state = this.readyState();
    if (state == null) return;
    const trimmed = normalizeModuleName(name);
    assertModuleNameAvailable(trimmed, state.registry.modules);
    const created = blankStore();
    const entry: ModuleState = {
      id: crypto.randomUUID(),
      name: trimmed,
      archivedAt: null,
      content: moduleContentOf(created),
    };
    const stashed = this.stashActiveModule(state);
    this.showModule(state, created, { ...stashed, activeModuleId: entry.id, modules: [...stashed.modules, entry] });
  };

  /** Throws when the name is empty, invalid, or another module has it. */
  renameModule = (id: string, name: string): void => {
    const current = this.readyState()?.registry;
    if (current == null || !current.modulesEnabled) return;
    if (!current.modules.some((entry) => entry.id === id)) return;
    const trimmed = normalizeModuleName(name);
    assertModuleNameAvailable(trimmed, current.modules.filter((entry) => entry.id !== id));
    this.commitRegistry({
      ...current,
      modules: current.modules.map((entry) => (entry.id === id ? { ...entry, name: trimmed } : entry)),
    });
  };

  /**
   * Rejects when the name is empty or another project has it. The name is
   * the project's identity, not its state, so renaming is no change to it;
   * the next write stores the name.
   */
  renameProject = async (name: string): Promise<void> => {
    const state = this.readyState();
    if (state == null) return;
    const projectId = state.project.id;
    const trimmed = name.trim();
    if (trimmed.length === 0) throw new UserFacingError("Name the project.");
    const projects = await this.persistence.projects.list();
    if (hasProjectName(projects.filter(({ id }) => id !== projectId), trimmed)) {
      throw new UserFacingError(`A project named “${trimmed}” already exists.`);
    }
    const current = this.readyState();
    if (current == null || current.project.id !== projectId) return;
    this.state = { ...current, project: { ...current.project, name: trimmed } };
    this.persistProject();
    this.publish();
  };

  archiveModule = (id: string): void => {
    const current = this.readyState()?.registry;
    if (current == null || id === current.activeModuleId) return;
    const target = current.modules.find((entry) => entry.id === id);
    if (target == null || target.archivedAt != null) return;
    if (visibleModules(current).length <= 1) return;
    this.commitRegistry({
      ...current,
      modules: current.modules.map((entry) =>
        entry.id === id
          ? { ...entry, archivedAt: new Date().toISOString() }
          : entry,
      ),
    });
  };

  /** Replace the open project with an exported one, read by the one project parser. Throws what is wrong with it, changing nothing. */
  importProjectFile = (data: unknown): void => {
    const state = this.readyState();
    if (state == null) throw new UserFacingError("Import once the project has finished opening.");
    const imported = parseProject(data);
    this.beginOperation();
    this.showProjectState(state.project, imported);
  };

  /** The open project as an export holds it. */
  exportProject = (options: ExportOptions, restorePointId?: string): string => {
    const state = this.readyState();
    if (state == null) throw new UserFacingError("Export once the project has finished opening.");
    if (restorePointId != null) throw new Error("Restore points cannot be exported yet.");
    return buildExport(projectState(state.registry, state.store), options);
  };

  /** Create an empty project. Rejects when the name is empty or another project has it. */
  createProject = async (name: string): Promise<ProjectIdentity> => {
    const trimmed = name.trim();
    if (trimmed.length === 0) throw new UserFacingError("Name the project.");
    const projects = await this.persistence.projects.list();
    if (hasProjectName(projects, trimmed)) throw new UserFacingError(`A project named “${trimmed}” already exists.`);
    const project = { id: crypto.randomUUID(), name: trimmed };
    await this.storeNewProject(project, blankProjectState());
    return project;
  };

  /**
   * Store an exported project as a new one, named after its file, leaving
   * every other project as it was. Rejects with what is wrong with the file.
   */
  importNewProject = async (data: unknown, fileName: string): Promise<ProjectIdentity> => {
    const imported = parseProject(data);
    const projects = await this.persistence.projects.list();
    const baseName = fileName.replace(/\.json$/i, "").trim() || "Imported project";
    let name = baseName;
    for (let suffix = 1; hasProjectName(projects, name); suffix += 1) name = `${baseName} (${suffix})`;
    const project = { id: crypto.randomUUID(), name };
    await this.storeNewProject(project, imported);
    return project;
  };

  /** Store a project storage does not hold yet, with a history that names it as written. */
  private storeNewProject(project: ProjectIdentity, state: ProjectState): Promise<void> {
    const pieces = new PieceStore();
    const address = pieces.addressOf(state);
    return this.persistence.projects.create({
      project,
      state,
      address,
      pieces: [...pieces.reachable([address])].map((piece) => [piece, pieces.get(piece)!.bytes] as const),
      writing: { ...EMPTY_HISTORY, writing: address },
      written: { ...EMPTY_HISTORY, lastWritten: address },
    });
  }
}

/** The module summaries the interface renders for a registry. */
export function moduleSummaries(
  registry: ModuleRegistry | null,
): ModuleSummary[] {
  if (registry == null) return [];
  return visibleModules(registry).map((entry) => ({
    id: entry.id,
    name: entry.name,
    active: entry.id === registry.activeModuleId,
  }));
}
