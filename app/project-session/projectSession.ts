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
  siblingModuleEntries,
  visibleModules,
} from "lib/moduleSchema";
import type { ProjectMeta } from "lib/projectStorage";
import {
  createModuleStore,
  type SiblingModuleReference,
  Store,
} from "store";
import { WorkflowStage } from "store/constants";
import {
  attachTimeline,
  clearTimelineSaveTimer,
  flushTimeline,
} from "store/timeline/controller";

/** Streaming mutates the store every ~80ms; coalesce writes behind this delay. */
export const PROJECT_SAVE_DEBOUNCE_MS = 800;

/**
 * The persistence operations a project session needs. Passed in so tests and
 * later phases can supply a different implementation without changing the
 * orchestration.
 */
export interface ProjectSessionStorage {
  loadProjectData(id: string): Record<string, unknown> | null;
  saveProjectData(id: string, data: unknown): void;
  getProjectsIndex(): ProjectMeta[];
  saveProjectsIndex(projects: ProjectMeta[]): void;
  loadTimelineData(
    projectId: string,
    moduleId: string,
  ): Record<string, unknown> | null;
  saveTimelineData(
    projectId: string,
    moduleId: string,
    data: unknown,
  ): boolean;
}

/** One visible module as the interface sees it. */
export interface ModuleSummary {
  id: string;
  name: string;
  active: boolean;
}

export interface ProjectSessionSnapshot {
  activeProject: { id: string; name: string } | null;
  persistenceError: string | null;
  registry: ModuleRegistry | null;
  store: Store;
}

/** The store a module export reads from. */
export interface ExportableModule {
  id: string;
  name: string | null;
  store: Store;
}

interface SiblingCacheEntry {
  snapshot: Record<string, unknown>;
  store: Store;
}

interface PendingOverviewSeed {
  projectId: string;
  seed: string;
}

/**
 * A project's authority-side session: the live store, the module registry,
 * and the pending project write. Framework-free so a later phase can host
 * the same orchestration in a local Node process or a Durable Object.
 * Subscribers observe changes to the session (store, registry, project,
 * persistence error), not every store mutation.
 */
export class ProjectSession {
  private readonly storage: ProjectSessionStorage;
  private readonly listeners = new Set<() => void>();
  private readonly siblingCache = new Map<string, SiblingCacheEntry>();

  private state: ProjectSessionSnapshot;
  private storeValue: Store;
  private registryValue: ModuleRegistry | null = null;
  private activeProjectValue: { id: string; name: string } | null = null;
  private persistenceErrorValue: string | null = null;
  private pendingOverviewSeed: PendingOverviewSeed | null = null;

  private unsubscribeStore: (() => void) | null = null;
  private flushPendingSave: (() => void) | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(storage: ProjectSessionStorage) {
    this.storage = storage;
    this.storeValue = Store.create({ productOverview: {} });
    this.state = {
      activeProject: null,
      persistenceError: null,
      registry: null,
      store: this.storeValue,
    };
  }

  // Public operations are arrow properties: React context passes them to
  // consumers as bare callbacks, where prototype methods would lose `this`.
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): ProjectSessionSnapshot => this.state;

  /** Attach the kept session to process-global timeline state. */
  start = (): void => {
    this.disposed = false;
    if (this.activeProjectValue != null && this.unsubscribeStore == null) {
      this.attachStoreSubscription();
    }
    this.attachCurrentTimeline();
  };

  /** Stop autosave and release the timeline timer. Safe to call repeatedly. */
  dispose = (): void => {
    if (this.disposed) return;
    this.disposed = true;
    this.detachStoreSubscription();
    flushTimeline();
    clearTimelineSaveTimer();
  };

  private publish(): void {
    this.state = {
      activeProject: this.activeProjectValue,
      persistenceError: this.persistenceErrorValue,
      registry: this.registryValue,
      store: this.storeValue,
    };
    this.listeners.forEach((listener) => listener());
  }

  private setPersistenceError(message: string | null): void {
    if (this.persistenceErrorValue === message) return;
    this.persistenceErrorValue = message;
    this.publish();
  }

  /**
   * Write the current registry and live snapshot. Every write goes through
   * here, matching the provider's one save path.
   */
  private persistProject(
    projectId: string,
    currentRegistry: ModuleRegistry,
    snapshot: Record<string, unknown>,
  ): void {
    try {
      this.storage.saveProjectData(
        projectId,
        buildProjectPayload(currentRegistry, snapshot),
      );

      const projects = this.storage.getProjectsIndex();
      const index = projects.findIndex((project) => project.id === projectId);
      if (index >= 0) {
        const overview = snapshot.productOverview as
          | Record<string, unknown>
          | undefined;
        const purpose = overview?.purpose;
        projects[index].description =
          typeof purpose === "string" ? purpose.slice(0, 200) : "";
        projects[index].updatedAt = new Date().toISOString();
        this.storage.saveProjectsIndex(projects);
      }
      this.setPersistenceError(null);
    } catch (error) {
      console.error("Could not persist project changes.", error);
      this.setPersistenceError(
        "Changes could not be saved in browser storage. Export the project to avoid losing work.",
      );
    }
  }

  private persistCurrent(): void {
    const project = this.activeProjectValue;
    const currentRegistry = this.registryValue;
    if (project == null || currentRegistry == null) return;
    this.persistProject(
      project.id,
      currentRegistry,
      getSnapshot(this.storeValue) as unknown as Record<string, unknown>,
    );
  }

  private attachStoreSubscription(): void {
    const project = this.activeProjectValue;
    if (project == null) return;

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

    this.unsubscribeStore = onSnapshot(this.storeValue, (snapshot) => {
      pendingWrite = () => {
        const currentRegistry = this.registryValue;
        if (currentRegistry == null) return;
        this.persistProject(
          project.id,
          currentRegistry,
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

  private timelinePersistence(
    projectId: string,
    moduleId: string | null,
  ): { load: () => unknown; save: (data: unknown) => boolean } | undefined {
    if (moduleId == null) return undefined;
    return {
      load: () => this.storage.loadTimelineData(projectId, moduleId),
      save: (data: unknown) =>
        this.storage.saveTimelineData(projectId, moduleId, data),
    };
  }

  private attachCurrentTimeline(): void {
    const project = this.activeProjectValue;
    const moduleId = this.registryValue?.activeModuleId ?? null;
    attachTimeline(
      this.storeValue,
      project == null
        ? undefined
        : { persistence: this.timelinePersistence(project.id, moduleId) },
    );
  }

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
    const currentRegistry = this.registryValue;
    if (currentRegistry == null) {
      this.storeValue.setModuleContext({ moduleMode: false });
      this.storeValue.setSiblingModules([]);
      return;
    }
    this.storeValue.setModuleContext({
      moduleMode: currentRegistry.modulesEnabled,
    });
    this.storeValue.setSiblingModules(this.buildSiblingStores(currentRegistry));
  }

  /**
   * Make `created` the live store under `nextRegistry`: subscribe, persist,
   * refresh module context, and attach the timeline, in that order.
   */
  private openStore(
    created: Store,
    nextRegistry: ModuleRegistry,
  ): void {
    this.detachStoreSubscription();
    this.registryValue = nextRegistry;
    this.storeValue = created;
    this.attachStoreSubscription();
    this.persistCurrent();
    this.syncModuleContext();
    this.attachCurrentTimeline();
    this.publish();
  }

  /** Registry-only changes persist immediately; store mutations stay debounced. */
  private commitRegistry(nextRegistry: ModuleRegistry): void {
    this.registryValue = nextRegistry;
    this.persistCurrent();
    this.syncModuleContext();
    this.publish();
  }

  private flushPendingWrites(): void {
    this.flushPendingSave?.();
    flushTimeline();
  }

  /** Flush everything the tab would otherwise lose, e.g. on unload. */
  flush = (): void => {
    this.flushPendingWrites();
  };

  reloadStore = (): void => {
    const snapshot = getSnapshot(this.storeValue);
    if (this.registryValue == null) {
      this.detachStoreSubscription();
      this.storeValue = Store.create(snapshot);
      this.attachStoreSubscription();
      this.attachCurrentTimeline();
      this.publish();
      return;
    }
    const nextRegistry = this.registryValue;
    this.openStore(Store.create(snapshot), nextRegistry);
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
  ): void => {
    // Finish the outgoing project's writes before anything is replaced.
    this.flushPendingWrites();

    const data = this.storage.loadProjectData(id);
    let loadedRegistry: ModuleRegistry | null = null;
    let failure: string | null = null;
    if (data != null) {
      try {
        loadedRegistry = parseProjectPayload(data);
      } catch (error) {
        console.error("Stored project data is invalid.", error);
        failure = "The stored project was invalid, so a blank project was opened.";
      }
    }

    let created: Store;
    let nextRegistry: ModuleRegistry;
    let moduleId: string;
    if (loadedRegistry != null) {
      try {
        const entry = pickActiveModule(loadedRegistry);
        created = createModuleStore(entry.snapshot);
        nextRegistry = loadedRegistry;
        moduleId = entry.id;
      } catch (error) {
        console.error("Stored project data is invalid.", error);
        created = Store.create({ productOverview: {} });
        nextRegistry = createEmptyRegistry();
        moduleId = LEGACY_MODULE_ID;
        failure =
          failure ?? "The stored project was invalid, so a blank project was opened.";
      }
    } else {
      created = Store.create({ productOverview: {} });
      nextRegistry = createEmptyRegistry();
      moduleId = LEGACY_MODULE_ID;
    }

    this.activeProjectValue = { id, name };
    this.persistenceErrorValue = failure;
    const seed = options?.overviewSeed?.trim();
    if (seed != null && seed.length > 0) {
      this.pendingOverviewSeed = { projectId: id, seed };
    }
    this.openStore(created, { ...nextRegistry, activeModuleId: moduleId });
  };

  backToProjects = (): void => {
    this.flushPendingWrites();
    this.pendingOverviewSeed = null;
    this.registryValue = null;
    this.activeProjectValue = null;
    this.detachStoreSubscription();
    this.syncModuleContext();
    this.setPersistenceError(null);
    this.publish();
  };

  clearPersistenceError = (): void => {
    this.setPersistenceError(null);
  };

  enableModules = (name: string): void => {
    const current = this.registryValue;
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
    const current = this.registryValue;
    if (current == null) return false;
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
    // Persist the outgoing module before its registry entry is replaced.
    this.flushPendingWrites();
    const stashed = current.modules.map((entry) =>
      entry.id === current.activeModuleId
        ? { ...entry, snapshot: getSnapshot(this.storeValue) as unknown as Record<string, unknown> }
        : entry,
    );
    this.openStore(created, { ...current, activeModuleId: id, modules: stashed });
    return true;
  };

  addModule = (name: string): void => {
    const current = this.registryValue;
    if (current == null) return;
    const trimmed = normalizeModuleName(name);
    assertModuleNameAvailable(trimmed, current.modules);
    this.flushPendingWrites();
    const created = Store.create({ productOverview: {} });
    const entry: ModuleEntry = {
      id: crypto.randomUUID(),
      name: trimmed,
      archivedAt: null,
      openStep: WorkflowStage.ProductOverview,
      snapshot: getSnapshot(created) as unknown as Record<string, unknown>,
    };
    const stashed = current.modules.map((module) =>
      module.id === current.activeModuleId
        ? { ...module, snapshot: getSnapshot(this.storeValue) as unknown as Record<string, unknown> }
        : module,
    );
    this.openStore(created, {
      ...current,
      activeModuleId: entry.id,
      modules: [...stashed, entry],
    });
  };

  archiveModule = (id: string): void => {
    const current = this.registryValue;
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
    const current = this.registryValue;
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
    const currentRegistry = this.registryValue;
    if (currentRegistry == null) return [];
    const modules: ExportableModule[] = [];
    for (const entry of visibleModules(currentRegistry)) {
      const name = currentRegistry.modulesEnabled ? entry.name : null;
      if (entry.id === currentRegistry.activeModuleId) {
        modules.push({ id: entry.id, name, store: this.storeValue });
        continue;
      }
      const sibling = this.siblingStoreFor(currentRegistry, entry);
      if (sibling != null) modules.push({ id: entry.id, name, store: sibling });
    }
    return modules;
  };

  importProjectFile = (data: unknown): void => {
    const project = this.activeProjectValue;
    if (project == null) return;
    // Drop any pending write of the outgoing state; the import replaces it.
    this.flushPendingWrites();
    const payload = parseProjectPayload(data);
    // Every module passes through the validation gate before storage.
    for (const entry of payload.modules) {
      createModuleStore(entry.snapshot);
    }
    this.storage.saveProjectData(project.id, payload);
    this.selectProject(project.id, project.name);
  };
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
