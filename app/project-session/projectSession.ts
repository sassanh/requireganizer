import { getSnapshot, onSnapshot } from "mobx-state-tree";

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
  siblingModuleEntries,
  visibleModules,
} from "lib/moduleSchema";
import type { PersistenceAdapter } from "persistence";
import {
  createModuleStore,
  type SiblingModuleReference,
  Store,
} from "store";
import { WorkflowStage } from "store/constants";
import {
  attachTimeline,
  clearTimelineSaveTimer,
  detachTimeline,
  flushTimeline,
} from "store/timeline/controller";

/** Streaming mutates the store every ~80ms; coalesce writes behind this delay. */
export const PROJECT_SAVE_DEBOUNCE_MS = 800;

/** One visible module as the interface sees it. */
export interface ModuleSummary {
  id: string;
  name: string;
  active: boolean;
}

export type ProjectSessionStatus = "idle" | "loading" | "ready";

/**
 * The session's observable state. The status and the fields it allows move
 * together: an idle session has no project, a loading session has a named
 * project but no registry yet, and a ready session has both a registry and
 * a store to render. A module switch stays ready while its timeline loads.
 */
export type ProjectSessionSnapshot =
  | {
      status: "idle";
      activeProject: null;
      persistenceError: null;
      registry: null;
      store: Store;
    }
  | {
      status: "loading";
      activeProject: { id: string; name: string };
      persistenceError: null;
      registry: null;
      store: Store;
    }
  | {
      status: "ready";
      activeProject: { id: string; name: string };
      persistenceError: string | null;
      registry: ModuleRegistry;
      store: Store;
    };

/** The store a module export reads from. */
export interface ExportableModule {
  id: string;
  name: string | null;
  store: Store;
}

interface ProjectIdentity {
  id: string;
  name: string;
}

interface SiblingCacheEntry {
  snapshot: Record<string, unknown>;
  store: Store;
}

interface PendingOverviewSeed {
  projectId: string;
  seed: string;
}

interface OpenedProject {
  created: Store;
  nextRegistry: ModuleRegistry;
  moduleId: string;
  failure: string | null;
}

/**
 * Where the shown module's timeline is. While it loads, or after its load
 * failed, the controller is detached: nothing is recorded or saved for the
 * module, so its stored history is never overwritten.
 */
type ModuleTimelineStatus = "loading" | "attached" | "unavailable";

/**
 * A message for the persistence banner. A successful save clears only a
 * message a failed save set, never a load warning.
 */
interface PersistenceNotice {
  source: "write" | "load";
  message: string;
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

type OpenSessionFields = {
  project: ProjectIdentity;
  registry: ModuleRegistry;
  store: Store;
  timeline: ModuleTimelineStatus;
  persistenceNotice: PersistenceNotice | null;
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
  | OpenSessionState;

const PROJECT_SAVE_ERROR_MESSAGE =
  "Changes could not be saved in browser storage. Export the project to avoid losing work.";
const INVALID_STORED_PROJECT_MESSAGE =
  "The stored project was invalid, so a blank project was opened.";

function snapshotOf(state: SessionState): ProjectSessionSnapshot {
  switch (state.status) {
    case "idle":
      return {
        status: "idle",
        activeProject: null,
        persistenceError: null,
        registry: null,
        store: state.store,
      };
    case "loading-project":
      return {
        status: "loading",
        activeProject: state.project,
        persistenceError: null,
        registry: null,
        store: state.store,
      };
    case "ready":
    case "importing":
      return {
        status: "ready",
        activeProject: state.project,
        persistenceError: state.persistenceNotice?.message ?? null,
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
  private readonly siblingCache = new Map<string, SiblingCacheEntry>();

  private state: SessionState;
  private snapshot: ProjectSessionSnapshot;
  private pendingOverviewSeed: PendingOverviewSeed | null = null;

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
  private flushPendingSave: (() => void) | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(persistence: PersistenceAdapter) {
    this.persistence = persistence;
    const store = Store.create({ productOverview: {} });
    this.state = { status: "idle", store };
    this.snapshot = snapshotOf(this.state);
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
    this.snapshot = snapshotOf(this.state);
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

  private setPersistenceNotice(
    update: (notice: PersistenceNotice | null) => PersistenceNotice | null,
  ): void {
    const state = this.state;
    if (!isOpen(state)) return;
    const notice = update(state.persistenceNotice);
    if (notice === state.persistenceNotice) return;
    this.state = { ...state, persistenceNotice: notice };
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
          this.setPersistenceNotice((notice) =>
            notice?.source === "write" ? null : notice,
          );
        },
        (error: unknown) => {
          console.error("Could not persist project changes.", error);
          if (!isLatest()) return;
          this.setPersistenceNotice((notice) =>
            notice?.source === "write"
              ? notice
              : { source: "write", message: PROJECT_SAVE_ERROR_MESSAGE },
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
    // Never drop unsaved changes when the store or project switches.
    this.flushPendingSave?.();
    this.flushPendingSave = null;
  }

  /** Issue every pending project and timeline write, synchronously. */
  private flushPendingWrites(): void {
    this.flushPendingSave?.();
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
    const state = this.state;
    switch (state.status) {
      case "idle":
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
    this.beginOperation();
    this.detachStoreSubscription();
    void flushTimeline();
    clearTimelineSaveTimer();
  };

  private siblingStoreFor(
    currentRegistry: ModuleRegistry,
    entry: ModuleEntry,
  ): Store | null {
    const hit = this.siblingCache.get(entry.id);
    if (hit != null && hit.snapshot === entry.snapshot) return hit.store;
    let created: Store;
    try {
      created = createModuleStore(entry.snapshot);
    } catch (error) {
      console.error(`Module “${entry.name}” could not be read.`, error);
      return null;
    }
    created.setModuleContext({ moduleMode: currentRegistry.modulesEnabled });
    this.siblingCache.set(entry.id, { snapshot: entry.snapshot, store: created });
    return created;
  }

  private buildSiblingStores(
    currentRegistry: ModuleRegistry,
  ): SiblingModuleReference[] {
    for (const id of [...this.siblingCache.keys()]) {
      const entry = currentRegistry.modules.find(
        (module) => module.id === id,
      );
      if (entry == null || entry.archivedAt != null) {
        this.siblingCache.delete(id);
      }
    }
    const references: SiblingModuleReference[] = [];
    for (const entry of siblingModuleEntries(currentRegistry)) {
      const sibling = this.siblingStoreFor(currentRegistry, entry);
      if (sibling != null) references.push({ id: entry.id, store: sibling });
    }
    return references;
  }

  private syncModuleContext(): void {
    const state = this.state;
    if (!isOpen(state)) {
      state.store.setModuleContext({ moduleMode: false });
      state.store.setSiblingModules([]);
      return;
    }
    state.store.setModuleContext({ moduleMode: state.registry.modulesEnabled });
    state.store.setSiblingModules(this.buildSiblingStores(state.registry));
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
    persistenceNotice: PersistenceNotice | null = null,
  ): void {
    this.detachStoreSubscription();
    if (timeline.status === "loading") detachTimeline();
    const state: ReadySessionState = {
      status: "ready",
      project,
      registry,
      store,
      timeline: timeline.status,
      persistenceNotice,
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

  private readOpenedProject(
    data: Record<string, unknown> | null,
  ): OpenedProject {
    let loadedRegistry: ModuleRegistry | null = null;
    let failure: string | null = null;
    if (data != null) {
      try {
        loadedRegistry = parseProjectPayload(data);
      } catch (error) {
        console.error("Stored project data is invalid.", error);
        failure = INVALID_STORED_PROJECT_MESSAGE;
      }
    }

    if (loadedRegistry != null) {
      try {
        const entry = pickActiveModule(loadedRegistry);
        return {
          created: createModuleStore(entry.snapshot),
          nextRegistry: loadedRegistry,
          moduleId: entry.id,
          failure,
        };
      } catch (error) {
        console.error("Stored project data is invalid.", error);
        failure = INVALID_STORED_PROJECT_MESSAGE;
      }
    }

    return {
      created: Store.create({ productOverview: {} }),
      nextRegistry: createEmptyRegistry(),
      moduleId: LEGACY_MODULE_ID,
      failure,
    };
  }

  /** Leave whatever is shown and load a project from storage. */
  private openProject(project: ProjectIdentity): Promise<void> {
    // Finish the outgoing writes before anything is replaced.
    this.flushPendingWrites();
    const generation = this.beginOperation();
    this.detachStoreSubscription();
    detachTimeline();
    this.state = { status: "loading-project", project, store: this.state.store };
    this.publish();
    return this.loadProject(project, generation);
  }

  /**
   * Load a project payload and its active module timeline, then show the
   * store. A superseded load is dropped after each await; a failed load ends
   * idle instead of leaving the session loading forever.
   */
  private async loadProject(
    project: ProjectIdentity,
    generation: number,
  ): Promise<void> {
    try {
      const data = await this.persistence.projects.load(project.id);
      if (!this.isOperationCurrent(generation)) return;

      const opened = this.readOpenedProject(data);
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
        opened.failure == null
          ? null
          : { source: "load", message: opened.failure },
      );
    } catch (error) {
      if (!this.isOperationCurrent(generation)) return;
      console.error("Could not load the project.", error);
      this.detachStoreSubscription();
      detachTimeline();
      this.state = { status: "idle", store: this.state.store };
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
    return this.openProject({ id, name });
  };

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
    this.setPersistenceNotice(() => null);
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
    const created = Store.create({ productOverview: {} });
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
    const modules: ExportableModule[] = [];
    for (const entry of visibleModules(state.registry)) {
      const name = state.registry.modulesEnabled ? entry.name : null;
      if (entry.id === state.registry.activeModuleId) {
        modules.push({ id: entry.id, name, store: state.store });
        continue;
      }
      const sibling = this.siblingStoreFor(state.registry, entry);
      if (sibling != null) modules.push({ id: entry.id, name, store: sibling });
    }
    return modules;
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
