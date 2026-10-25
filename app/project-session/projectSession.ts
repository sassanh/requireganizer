import { getSnapshot, onSnapshot } from "mobx-state-tree";

import { getUserFacingErrorMessage, UserFacingError } from "lib/errors";
import {
  assertModuleNameAvailable,
  buildProjectPayload,
  createEmptyRegistry,
  LEGACY_MODULE_ID,
  type ModuleEntry,
  type ModuleRegistry,
  normalizeModuleName,
  parseProjectPayload,
  pickActiveModule,
  type ProjectPayload,
  visibleModules,
} from "lib/moduleSchema";
import type { OutsideChange, OutsideChanges, PersistenceAdapter } from "persistence";
import {
  createModuleStore,
  Store,
} from "store";
import { WorkflowStage } from "store/constants";
import {
  attachTimeline,
  clearTimelineSaveTimer,
  detachTimeline,
  flushTimeline,
} from "store/timeline/controller";

import { persistProviderCalls, type ProviderCallSaving } from "./providerCalls";
import { type ExportableModule, SiblingModuleStores } from "./siblingStores";

/** Streaming mutates the store every ~80ms; coalesce writes behind this delay. */
export const PROJECT_SAVE_DEBOUNCE_MS = 800;

/** One visible module as the interface sees it. */
export interface ModuleSummary {
  id: string;
  name: string;
  active: boolean;
}

export type ProjectSessionStatus = "idle" | "loading" | "failed" | "ready";

/**
 * The session's observable state. The status and the fields it allows move
 * together: an idle session has no project, a loading session has a named
 * project but no registry yet, a failed session names the project it could
 * not load and why, and a ready session has both a registry and a store to
 * render. A module switch stays ready while its timeline loads. A ready
 * project whose stored version changed outside the session names that
 * change until the person chooses which version to keep.
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
      status: "loading";
      activeProject: { id: string; name: string };
      persistenceError: null;
      outsideChange: null;
      registry: null;
      store: Store;
    }
  | {
      status: "failed";
      activeProject: { id: string; name: string };
      persistenceError: string;
      outsideChange: null;
      registry: null;
      store: Store;
    }
  | {
      status: "ready";
      activeProject: { id: string; name: string };
      persistenceError: string | null;
      outsideChange: OutsideChange | null;
      registry: ModuleRegistry;
      store: Store;
    };

/** The store of work not started yet: its overview carries the name the person gave it. */
function namedBlankStore(name: string): Store {
  return Store.create({ productOverview: { name } });
}

interface ProjectIdentity {
  id: string;
  name: string;
}

interface PendingOverviewSeed {
  projectId: string;
  seed: string;
}

interface OpenedProject {
  created: Store;
  nextRegistry: ModuleRegistry;
  moduleId: string;
}

/**
 * Where the shown module's timeline is. While it loads, or after its load
 * failed, the controller is detached: nothing is recorded or saved for the
 * module, so its stored history is never overwritten.
 */
type ModuleTimelineStatus = "loading" | "attached" | "unavailable";

/** What failed: a project write, or saving AI provider activity. */
type PersistenceNoticeSource = "write" | "activity";

/**
 * Messages for the persistence banner, at most one per source. A success
 * clears only its own source's message, so one failure never hides another.
 */
type PersistenceNotices = Partial<Record<PersistenceNoticeSource, string>>;

/** The order the banner shows its messages in: unsaved work first. */
const NOTICE_ORDER: readonly PersistenceNoticeSource[] = ["write", "activity"];

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

type OpenSessionFields = {
  project: ProjectIdentity;
  registry: ModuleRegistry;
  store: Store;
  timeline: ModuleTimelineStatus;
  persistenceNotices: PersistenceNotices;
};

type ReadySessionState = OpenSessionFields & { status: "ready" };

/**
 * An import's write is in flight. The page keeps showing the current store,
 * whose autosave is paused, and every other change is refused until the
 * write settles.
 */
type ImportingSessionState = OpenSessionFields & { status: "importing" };

type OpenSessionState = ReadySessionState | ImportingSessionState;

type SessionState =
  | IdleSessionState
  | LoadingProjectSessionState
  | FailedProjectSessionState
  | OpenSessionState;

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
      return {
        status: "loading",
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
    case "importing":
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

function isOpen(state: SessionState): state is OpenSessionState {
  return state.status === "ready" || state.status === "importing";
}

/**
 * A project's authority-side session: the live store, the module registry,
 * and the pending project write. Framework-free so a later phase can host
 * the same orchestration in a local Node process or a Durable Object.
 * Subscribers observe changes to the session (store, registry, project,
 * persistence error), not every store mutation.
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
   * or reloading a module, importing, and dispose. Async work captures the
   * generation it started under and drops its result once that moved on.
   */
  private operationGeneration = 0;
  /**
   * The persistence banner reflects the newest project write: an earlier
   * write that settles after a later one never sets or clears it.
   */
  private projectWriteSequence = 0;

  private unsubscribeStore: (() => void) | null = null;
  private providerCallSaving: ProviderCallSaving | null = null;
  private flushPendingSave: (() => void) | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly outsideChanges: OutsideChanges | null;
  /** How the stored project differs from the one the session holds. */
  private outsideChange: OutsideChange | null = null;
  private stopWatchingOutsideChanges: (() => void) | null = null;
  /** A project write was held back while an outside change stood. */
  private writeHeldBack = false;

  /** `outsideChanges` reports changes made to the stored project by anything else, for a storage that has them. */
  constructor(persistence: PersistenceAdapter, options: { outsideChanges?: OutsideChanges } = {}) {
    this.persistence = persistence;
    this.outsideChanges = options.outsideChanges ?? null;
    const store = Store.create({ productOverview: {} });
    this.state = { status: "idle", store };
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

  /**
   * Whether an import's write is in flight. The snapshot shows the current
   * store as ready meanwhile, but the import replaces it once the write lands.
   */
  get importing(): boolean {
    return this.state.status === "importing";
  }

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

  /**
   * The open state a current-generation continuation resumes. Every
   * generation bump that leaves the open states also starts a new generation,
   * so reaching here in another state is a programming error.
   */
  private expectOpenState(): OpenSessionState {
    const state = this.state;
    if (!isOpen(state)) {
      throw new Error(`Expected an open project session, found ${state.status}.`);
    }
    return state;
  }

  /** Set or, with null, clear one source's message. */
  private setPersistenceNotice(source: PersistenceNoticeSource, message: string | null): void {
    const state = this.state;
    if (!isOpen(state)) return;
    if ((state.persistenceNotices[source] ?? null) === message) return;
    const notices = { ...state.persistenceNotices };
    if (message == null) delete notices[source];
    else notices[source] = message;
    this.state = { ...state, persistenceNotices: notices };
    this.publish();
  }

  /**
   * Write the registry and a snapshot. Every project write goes through here.
   * The adapter refreshes this project's index entry itself, so the rest of
   * the index is never replaced from a stale copy.
   */
  private persistProject(
    project: ProjectIdentity,
    currentRegistry: ModuleRegistry,
    snapshot: Record<string, unknown>,
  ): void {
    // Written once the person has chosen which version to keep. Storage
    // would refuse it, and the refusal could arrive after the choice.
    if (this.outsideChange != null) {
      this.writeHeldBack = true;
      return;
    }
    const sequence = ++this.projectWriteSequence;
    const isLatest = (): boolean => sequence === this.projectWriteSequence;

    const overview = snapshot.productOverview as
      | Record<string, unknown>
      | undefined;
    const purpose = overview?.purpose;
    void this.persistence.projects
      .save(project.id, buildProjectPayload(currentRegistry, snapshot), {
        description: typeof purpose === "string" ? purpose.slice(0, 200) : "",
        updatedAt: new Date().toISOString(),
      })
      .then(
        () => {
          if (!isLatest()) return;
          this.setPersistenceNotice("write", null);
        },
        (error: unknown) => {
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

  private persistCurrent(): void {
    const state = this.state;
    if (!isOpen(state)) return;
    this.persistProject(
      state.project,
      state.registry,
      getSnapshot(state.store) as unknown as Record<string, unknown>,
    );
  }

  private attachStoreSubscription(state: OpenSessionState): void {
    this.unsubscribeStore?.();
    this.unsubscribeStore = null;
    this.providerCallSaving?.stop();
    this.providerCallSaving = null;

    const { project, store } = state;
    let pendingWrite: (() => void) | null = null;
    const flushPendingWrite = () => {
      if (this.saveTimer != null) {
        clearTimeout(this.saveTimer);
        this.saveTimer = null;
      }
      pendingWrite?.();
      pendingWrite = null;
    };
    this.flushPendingSave = flushPendingWrite;
    this.providerCallSaving = persistProviderCalls(
      this.persistence,
      project.id,
      state.registry.activeModuleId,
      store,
      (message) => this.setPersistenceNotice("activity", message),
    );

    this.unsubscribeStore = onSnapshot(store, (snapshot) => {
      pendingWrite = () => {
        const current = this.state;
        if (!isOpen(current)) return;
        this.persistProject(
          project,
          current.registry,
          snapshot as unknown as Record<string, unknown>,
        );
      };
      if (this.saveTimer == null) {
        this.saveTimer = setTimeout(() => {
          this.saveTimer = null;
          flushPendingWrite();
        }, PROJECT_SAVE_DEBOUNCE_MS);
      }
    });
  }

  private detachStoreSubscription(): void {
    this.unsubscribeStore?.();
    this.unsubscribeStore = null;
    this.providerCallSaving?.stop();
    this.providerCallSaving = null;
    // Never drop unsaved changes when the store or project switches.
    this.flushPendingSave?.();
    this.flushPendingSave = null;
  }

  /** Issue every pending project and timeline write, synchronously. */
  private flushPendingWrites(): void {
    this.flushPendingSave?.();
    this.providerCallSaving?.flush();
    void flushTimeline();
  }

  /** Attach the shown store's timeline with the data the session loaded. */
  private attachLoadedTimeline(
    state: OpenSessionState,
    loaded: Record<string, unknown> | null,
  ): void {
    const projectId = state.project.id;
    const moduleId = state.registry.activeModuleId;
    attachTimeline(state.store, {
      persistence: {
        save: (data: unknown) =>
          this.persistence.timelines.save(projectId, moduleId, data),
      },
      loaded,
    });
  }

  /** Re-issue a module timeline load that a newer generation cancelled. */
  private resumeTimelineLoad(): void {
    const state = this.state;
    if (state.status !== "ready" || state.timeline !== "loading") return;
    void this.loadModuleTimeline(
      state.project,
      state.registry.activeModuleId,
      this.beginOperation(),
    );
  }

  /**
   * Restart whatever `dispose` cancelled: a project load, an import whose
   * outcome is unknown (the stored project is reopened, so it shows whatever
   * the write left), or a module timeline load.
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
        return;
      case "loading-project":
      case "importing":
        this.openProject(state.project);
        return;
      case "ready":
        if (this.unsubscribeStore == null) this.attachStoreSubscription(state);
        this.resumeTimelineLoad();
    }
  };

  /**
   * Stop autosave and release the timeline timer after issuing every pending
   * write. Safe to call repeatedly. A later `start` resumes what this
   * cancelled.
   */
  dispose = (): void => {
    if (this.writeHeldBack) {
      console.error(
        `${this.persistence.traits.name} changed outside Requireganizer, so the changes made since were not saved. They stay in the project's history: undo after opening the project returns to them.`,
      );
    }
    this.stopWatchingOutsideChanges?.();
    this.stopWatchingOutsideChanges = null;
    this.beginOperation();
    this.detachStoreSubscription();
    void flushTimeline();
    clearTimelineSaveTimer();
  };

  private syncModuleContext(): void {
    const state = this.state;
    this.siblingStores.applyModuleContext(
      state.store,
      isOpen(state) ? state.registry : null,
    );
  }

  /**
   * Show a store and registry and persist them. With `loaded` the timeline
   * is attached at once; without it the timeline stays detached until
   * `loadModuleTimeline` brings the module's stored history.
   */
  private showStore(
    project: ProjectIdentity,
    store: Store,
    registry: ModuleRegistry,
    timeline:
      | { status: "attached"; loaded: Record<string, unknown> | null }
      | { status: "loading" },
  ): void {
    this.detachStoreSubscription();
    if (timeline.status === "loading") detachTimeline();
    const state: ReadySessionState = {
      status: "ready",
      project,
      registry,
      store,
      timeline: timeline.status,
      persistenceNotices: {},
    };
    this.state = state;
    this.attachStoreSubscription(state);
    this.persistCurrent();
    this.syncModuleContext();
    if (timeline.status === "attached") {
      this.attachLoadedTimeline(state, timeline.loaded);
    }
    this.publish();
  }

  /** Registry-only changes persist immediately; store mutations stay debounced. */
  private commitRegistry(nextRegistry: ModuleRegistry): void {
    const state = this.readyState();
    if (state == null) return;
    this.state = { ...state, registry: nextRegistry };
    this.persistCurrent();
    this.syncModuleContext();
    this.publish();
  }

  /** The registry with the shown store's snapshot written into its entry. */
  private stashActiveModule(state: OpenSessionState): ModuleRegistry {
    const snapshot = getSnapshot(state.store) as unknown as Record<
      string,
      unknown
    >;
    return {
      ...state.registry,
      modules: state.registry.modules.map((entry) =>
        entry.id === state.registry.activeModuleId
          ? { ...entry, snapshot }
          : entry,
      ),
    };
  }

  /**
   * What a stored payload opens to, or a blank project named `name` when
   * nothing is stored yet. Invalid stored data is never replaced: it throws,
   * so the load ends failed and the data stays as it is.
   */
  private readOpenedProject(
    data: Record<string, unknown> | null,
    name: string,
  ): OpenedProject {
    if (data == null) {
      return { created: namedBlankStore(name), nextRegistry: createEmptyRegistry(), moduleId: LEGACY_MODULE_ID };
    }
    try {
      const registry = parseProjectPayload(data);
      const entry = pickActiveModule(registry);
      return { created: createModuleStore(entry.snapshot), nextRegistry: registry, moduleId: entry.id };
    } catch (error) {
      throw new UserFacingError(
        `${name} could not be opened because its stored data is invalid. It was left unchanged: delete it, or import a saved copy as a new project.`,
        error,
      );
    }
  }

  /** Leave whatever is shown and load a project from storage. */
  private openProject(project: ProjectIdentity): Promise<void> {
    // Finish the outgoing writes before anything is replaced.
    this.flushPendingWrites();
    // The project is read again, so a write held back has nothing to keep.
    this.writeHeldBack = false;
    const generation = this.beginOperation();
    this.detachStoreSubscription();
    detachTimeline();
    this.state = { status: "loading-project", project, store: this.state.store };
    this.publish();
    this.projectLoad = this.loadProject(project, generation);
    return this.projectLoad;
  }

  /**
   * Load a project payload and its active module timeline, then show the
   * store. A superseded load is dropped after each await; a failed load ends
   * failed, naming the project, instead of leaving the session loading.
   */
  private async loadProject(
    project: ProjectIdentity,
    generation: number,
  ): Promise<void> {
    try {
      // The session holds the project it opens: writes may replace it.
      this.outsideChanges?.adoptStored();
      const data = await this.persistence.projects.load(project.id);
      if (!this.isOperationCurrent(generation)) return;

      const opened = this.readOpenedProject(data, project.name);
      const timeline = await this.persistence.timelines.load(
        project.id,
        opened.moduleId,
      );
      if (!this.isOperationCurrent(generation)) return;

      this.showStore(
        project,
        opened.created,
        { ...opened.nextRegistry, activeModuleId: opened.moduleId },
        { status: "attached", loaded: timeline },
      );
    } catch (error) {
      if (!this.isOperationCurrent(generation)) return;
      console.error("Could not load the project.", error);
      this.detachStoreSubscription();
      detachTimeline();
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

  /**
   * Load the shown module's stored timeline and attach it. On failure the
   * module stays shown with its timeline unavailable: the store and registry
   * are already persisted, so rolling back would lose the edits made since.
   */
  private async loadModuleTimeline(
    project: ProjectIdentity,
    moduleId: string,
    generation: number,
  ): Promise<void> {
    try {
      const timeline = await this.persistence.timelines.load(
        project.id,
        moduleId,
      );
      if (!this.isOperationCurrent(generation)) return;
      const state: ReadySessionState = {
        ...this.expectOpenState(),
        status: "ready",
        timeline: "attached",
      };
      this.state = state;
      this.attachLoadedTimeline(state, timeline);
    } catch (error) {
      if (!this.isOperationCurrent(generation)) return;
      console.error("Could not load the module timeline.", error);
      this.state = {
        ...this.expectOpenState(),
        status: "ready",
        timeline: "unavailable",
      };
    }
  }

  /** Show a module whose stored timeline still has to be loaded. */
  private showModule(
    state: ReadySessionState,
    store: Store,
    registry: ModuleRegistry,
  ): void {
    const generation = this.beginOperation();
    // Issue the outgoing module's writes before its store is released.
    this.flushPendingWrites();
    this.showStore(state.project, store, registry, { status: "loading" });
    void this.loadModuleTimeline(
      state.project,
      registry.activeModuleId,
      generation,
    );
  }

  /** Flush everything the tab would otherwise lose, e.g. on unload. */
  flush = (): void => {
    this.flushPendingWrites();
  };

  /** Rebuild the store from its own snapshot, e.g. after a code reload. */
  reloadStore = (): void => {
    const state = this.state;
    // The import's outcome decides the next store; a later `start` reopens it.
    if (state.status === "importing") return;
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
    if ((state.status === "loading-project" || isOpen(state)) && state.project.id === id) {
      return this.projectLoad;
    }
    return this.openProject({ id, name });
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
      this.persistCurrent();
    }
    this.publish();
  }

  /**
   * Open the project as it now is in storage, after it changed outside the
   * session. The shown version stays one undo away: the timeline records the
   * opened project as a step after it.
   */
  openChangedProject = (): Promise<void> => {
    const state = this.choosableState();
    const change = this.outsideChange;
    if (change?.kind !== "changed") return Promise.resolve();
    if (change.problem != null) return Promise.reject(new UserFacingError(change.problem));
    if (state.store.isBusy) {
      return Promise.reject(
        new UserFacingError("Open the changed file once Requireganizer finishes its current work."),
      );
    }
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
      this.persistCurrent();
    }
  };

  /** The open project, while the choice between versions can be made. */
  private choosableState(): ReadySessionState {
    const state = this.readyState();
    if (state == null) {
      throw new UserFacingError("Choose which version to keep once the project has finished opening or importing.");
    }
    return state;
  }

  backToProjects = (): void => {
    this.flushPendingWrites();
    this.beginOperation();
    this.pendingOverviewSeed = null;
    this.detachStoreSubscription();
    detachTimeline();
    this.state = { status: "idle", store: this.state.store };
    this.syncModuleContext();
    this.publish();
  };

  clearPersistenceError = (): void => {
    const state = this.state;
    if (!isOpen(state) || Object.keys(state.persistenceNotices).length === 0) return;
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
    let created: Store;
    try {
      created = createModuleStore(target.snapshot);
    } catch (error) {
      console.error("The module could not be opened.", error);
      return false;
    }
    this.showModule(state, created, {
      ...this.stashActiveModule(state),
      activeModuleId: id,
    });
    return true;
  };

  addModule = (name: string): void => {
    const state = this.readyState();
    if (state == null) return;
    const trimmed = normalizeModuleName(name);
    assertModuleNameAvailable(trimmed, state.registry.modules);
    this.beginOperation();
    this.flushPendingWrites();
    const created = namedBlankStore(trimmed);
    const entry: ModuleEntry = {
      id: crypto.randomUUID(),
      name: trimmed,
      archivedAt: null,
      openStep: WorkflowStage.ProductOverview,
      snapshot: getSnapshot(created) as unknown as Record<string, unknown>,
    };
    const stashed = this.stashActiveModule(state);
    // A fresh module has no stored timeline, so there is nothing to load.
    this.showStore(
      state.project,
      created,
      {
        ...stashed,
        activeModuleId: entry.id,
        modules: [...stashed.modules, entry],
      },
      { status: "attached", loaded: null },
    );
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

  recordOpenStep = (step: WorkflowStage): void => {
    const current = this.readyState()?.registry;
    // Open steps are module-mode state: while modules are off the hidden
    // legacy entry keeps opening at the first stage, so enabling later
    // starts there rather than wherever tabbing left off.
    if (current == null || !current.modulesEnabled) return;
    const active = current.modules.find(
      (entry) => entry.id === current.activeModuleId,
    );
    if (active == null || active.openStep === step) return;
    this.commitRegistry({
      ...current,
      modules: current.modules.map((entry) =>
        entry.id === current.activeModuleId ? { ...entry, openStep: step } : entry,
      ),
    });
  };

  /** Every visible module, backed by its live or sibling store. */
  getExportModules = (): ExportableModule[] => {
    const state = this.state;
    if (!isOpen(state)) return [];
    return this.siblingStores.exportModules(state.registry, state.store);
  };

  /**
   * Import a project. Validation throws synchronously; the write's failure
   * rejects the returned promise, with the current module still shown and
   * its autosave resumed. While the write is in flight the page stays as it
   * is, autosave is paused and other changes are refused.
   */
  importProjectFile = (data: unknown): Promise<void> => {
    const state = this.readyState();
    if (state == null) return Promise.resolve();
    // Issue the outgoing state's pending writes; the import replaces them.
    this.flushPendingWrites();
    const payload = parseProjectPayload(data);
    // Every module passes through the validation gate before storage.
    for (const entry of payload.modules) {
      createModuleStore(entry.snapshot);
    }

    const generation = this.beginOperation();
    this.detachStoreSubscription();
    this.state = { ...state, status: "importing" };
    this.publish();
    return this.writeImportedProject(state.project, payload, generation);
  };

  private async writeImportedProject(
    project: ProjectIdentity,
    payload: ProjectPayload,
    generation: number,
  ): Promise<void> {
    try {
      await this.persistence.projects.save(project.id, payload);
    } catch (error) {
      if (this.isOperationCurrent(generation)) {
        console.error("Could not import project data.", error);
        const state: ReadySessionState = {
          ...this.expectOpenState(),
          status: "ready",
        };
        this.state = state;
        this.attachStoreSubscription(state);
        // Edits made while autosave was paused are written now.
        this.persistCurrent();
        this.publish();
        this.resumeTimelineLoad();
      }
      throw error;
    }
    if (!this.isOperationCurrent(generation)) return;
    await this.loadProject(project, generation);
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
