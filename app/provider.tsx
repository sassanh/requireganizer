"use client";
import DefaultPropsProvider from "@mui/material/DefaultPropsProvider";
import { ThemeProvider } from "@mui/material/styles";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v15-appRouter";
import { applySnapshot, getSnapshot, onSnapshot } from "mobx-state-tree";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

import { setAgentSessionId } from "ai-agent/agent";
import Link from "components/Link";
import { NoticeHost } from "components/NoticeHost";
import { useUndoRedoKeyboardShortcuts } from "hooks/useUndoRedoKeyboardShortcuts";
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
import {
  type CodeArchiveFormat,
  exportCodeArchive as runCodeArchiveExport,
  type ExportModule,
  exportProjectJson,
  exportProjectPdf,
  exportProjectText,
  type ProjectExportFormat,
} from "lib/projectExport";
import {
  getProjectsIndex,
  loadProjectData,
  loadTimelineData,
  saveProjectData,
  saveProjectsIndex,
  saveTimelineData,
} from "lib/projectStorage";
import {
  attachPresentation,
  presentationStoreContext,
  resetPresentation,
} from "presentation";
import {
  createModuleStore,
  hasGeneratedScaffoldIn,
  Store,
  storeContext,
  type SiblingModuleReference,
} from "store";
import { WorkflowStage } from "store/constants";
import { attachTimeline, flushTimeline } from "store/timeline/controller";

import { theme } from "./theme";

/** One visible module as the interface sees it. */
export interface ModuleSummary {
  id: string;
  name: string;
  active: boolean;
}

interface ProjectContextValue {
  activeProject: { id: string, name: string } | null;
  persistenceError: string | null;
  selectProject: (id: string, name: string, options?: { overviewSeed?: string }) => void;
  consumeOverviewSeed: (projectId: string) => string | null;
  backToProjects: () => void;
  clearPersistenceError: () => void;
  /** Visible modules of the open project, in creation order. */
  modules: ModuleSummary[];
  modulesEnabled: boolean;
  activeModuleId: string;
  /** The stage the active module last showed; reopening restores it. */
  activeModuleOpenStep: WorkflowStage;
  /** At least one visible module holds generated code. */
  codeExportAvailable: boolean;
  enableModules: (name: string) => void;
  addModule: (name: string) => void;
  /** False when the id names no openable module (unknown or archived). */
  switchModule: (id: string) => boolean;
  archiveModule: (id: string) => void;
  recordOpenStep: (step: WorkflowStage) => void;
  importProjectFile: (data: unknown) => void;
  exportProject: (format: ProjectExportFormat) => Promise<void>;
  exportCodeArchive: (format: CodeArchiveFormat) => void;
}

const projectContext = createContext<ProjectContextValue>({
  activeProject: null,
  persistenceError: null,
  selectProject: () => { },
  consumeOverviewSeed: () => null,
  backToProjects: () => { },
  clearPersistenceError: () => { },
  modules: [],
  modulesEnabled: false,
  activeModuleId: "",
  activeModuleOpenStep: WorkflowStage.ProductOverview,
  codeExportAvailable: false,
  enableModules: () => { },
  addModule: () => { },
  switchModule: () => false,
  archiveModule: () => { },
  recordOpenStep: () => { },
  importProjectFile: () => { },
  exportProject: async () => { },
  exportCodeArchive: () => { },
});

export const useProject = () => useContext(projectContext);

let isStoreReloadNeeded = true;

const PROJECT_SAVE_DEBOUNCE_MS = 800;

interface SiblingCacheEntry {
  snapshot: Record<string, unknown>;
  store: Store;
}

export default function Providers({ children }: { children: React.ReactNode }) {
  useUndoRedoKeyboardShortcuts();
  const [activeProject, setActiveProject] = useState<{ id: string, name: string } | null>(null);
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const [registry, setRegistry] = useState<ModuleRegistry | null>(null);
  const registryRef = useRef<ModuleRegistry | null>(null);
  const [store, setStore] = useState(() => {
    isStoreReloadNeeded = false;
    const initialStore = Store.create({ productOverview: {} });
    attachTimeline(initialStore);
    return initialStore;
  });
  const [shown] = useState(() => Store.create(getSnapshot(store)));

  const disposerRef = useRef<(() => void) | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveFlushRef = useRef<(() => void) | null>(null);
  const pendingOverviewSeedRef = useRef<{ projectId: string; seed: string } | null>(null);
  const siblingCacheRef = useRef(new Map<string, SiblingCacheEntry>());

  /**
   * The registry updates outside renders (timers, shortcuts), so every
   * callback reads the ref while React state drives re-renders. Both move
   * together, in this one place.
   */
  const applyRegistry = useCallback((next: ModuleRegistry | null) => {
    registryRef.current = next;
    setRegistry(next);
  }, []);

  const persistProject = useCallback(
    (
      projectId: string,
      currentRegistry: ModuleRegistry,
      snapshot: Record<string, unknown>,
    ) => {
      try {
        saveProjectData(projectId, buildProjectPayload(currentRegistry, snapshot));

        const projects = getProjectsIndex();
        const index = projects.findIndex((project) => project.id === projectId);
        if (index >= 0) {
          const overview = snapshot.productOverview as
            | Record<string, unknown>
            | undefined;
          const purpose = overview?.purpose;
          projects[index].description =
            typeof purpose === "string" ? purpose.slice(0, 200) : "";
          projects[index].updatedAt = new Date().toISOString();
          saveProjectsIndex(projects);
        }
        setPersistenceError(null);
      } catch (error) {
        console.error("Could not persist project changes.", error);
        setPersistenceError(
          "Changes could not be saved in browser storage. Export the project to avoid losing work.",
        );
      }
    },
    [],
  );

  // Auto-save store to localStorage whenever it changes
  useEffect(() => {
    disposerRef.current?.();
    disposerRef.current = null;

    if (!activeProject) return;

    // Streaming mutates the store every ~80ms; a synchronous localStorage
    // write per mutation drops frames and makes scrolling stutter. Coalesce
    // the writes: each mutation replaces the pending write, and a timer
    // flushes the latest one shortly after.
    let pendingWrite: (() => void) | null = null;
    const flushPendingWrite = () => {
      if (saveTimerRef.current != null) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      pendingWrite?.();
      pendingWrite = null;
    };
    pendingSaveFlushRef.current = flushPendingWrite;

    disposerRef.current = onSnapshot(store, (snapshot) => {
      // The module that was active when the change happened; a switch or
      // import that lands first owns the newer state, so this write steps aside.
      const eventModuleId = registryRef.current?.activeModuleId ?? null;
      pendingWrite = () => {
        const currentRegistry = registryRef.current;
        if (currentRegistry == null || currentRegistry.activeModuleId !== eventModuleId) {
          return;
        }
        persistProject(
          activeProject.id,
          currentRegistry,
          snapshot as unknown as Record<string, unknown>,
        );
      };
      if (saveTimerRef.current == null) {
        saveTimerRef.current = setTimeout(() => {
          saveTimerRef.current = null;
          flushPendingWrite();
        }, PROJECT_SAVE_DEBOUNCE_MS);
      }
    });

    return () => {
      disposerRef.current?.();
      disposerRef.current = null;
      // Never drop unsaved changes when the store or project switches.
      flushPendingWrite();
      pendingSaveFlushRef.current = null;
    };
  }, [store, activeProject, persistProject]);

  // Registry changes without a store change (module switches, adds,
  // archives, remembered steps) persist immediately; the debounced
  // store writer covers everything else.
  useEffect(() => {
    if (!activeProject || registry == null) return;
    // The setState this reports is the outcome of the external write, not
    // derived render state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    persistProject(
      activeProject.id,
      registry,
      getSnapshot(store) as unknown as Record<string, unknown>,
    );
  }, [registry, activeProject, store, persistProject]);

  useEffect(() => {
    if (isStoreReloadNeeded) {
      const snapshot = getSnapshot(store);
      resetPresentation();
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional one-time store reload
      setStore(Store.create(snapshot));
      isStoreReloadNeeded = false;
    }
  }, [store]);

  /**
   * A sibling module's store, built once per snapshot: switching or
   * saving replaces the active entry's snapshot object, which is exactly
   * when a rebuild is due.
   */
  const siblingStoreFor = useCallback(
    (currentRegistry: ModuleRegistry, entry: ModuleEntry): Store | null => {
      const cache = siblingCacheRef.current;
      const hit = cache.get(entry.id);
      if (hit != null && hit.snapshot === entry.snapshot) return hit.store;
      let created: Store;
      try {
        created = createModuleStore(entry.snapshot);
      } catch (error) {
        console.error(`Module “${entry.name}” could not be read.`, error);
        return null;
      }
      created.setModuleContext({ moduleMode: currentRegistry.modulesEnabled });
      cache.set(entry.id, { snapshot: entry.snapshot, store: created });
      return created;
    },
    [],
  );

  const buildSiblingStores = useCallback(
    (currentRegistry: ModuleRegistry): SiblingModuleReference[] => {
      const cache = siblingCacheRef.current;
      for (const id of [...cache.keys()]) {
        const entry = currentRegistry.modules.find(
          (module) => module.id === id,
        );
        if (entry == null || entry.archivedAt != null) {
          cache.delete(id);
        }
      }
      const references: SiblingModuleReference[] = [];
      for (const entry of siblingModuleEntries(currentRegistry)) {
        const sibling = siblingStoreFor(currentRegistry, entry);
        if (sibling != null) references.push({ id: entry.id, store: sibling });
      }
      return references;
    },
    [siblingStoreFor],
  );

  // The live store carries module-mode copy and the sibling modules used
  // for display-level reference resolution; keep them current.
  useEffect(() => {
    if (registry == null) {
      store.setModuleContext({ moduleMode: false });
      store.setSiblingModules([]);
      return;
    }
    store.setModuleContext({ moduleMode: registry.modulesEnabled });
    store.setSiblingModules(buildSiblingStores(registry));
  }, [store, registry, buildSiblingStores]);

  // Every store instance that becomes the active one gets the timeline.
  // Instances tied to a project persist their timeline in that project's
  // storage under the active module; the scratch store stays session-only.
  const timelinePersistence = useCallback(
    (projectId: string | null, moduleId: string | null) => {
      if (projectId == null || moduleId == null) return undefined;
      return {
        load: () => loadTimelineData(projectId, moduleId),
        save: (data: unknown) => saveTimelineData(projectId, moduleId, data),
      };
    },
    [],
  );

  // A stable per-project session id gives the provider's prompt cache a
  // consistent affinity key for every LLM request of this project.
  useEffect(() => {
    setAgentSessionId(activeProject?.id ?? null);
  }, [activeProject]);

  useEffect(() => {
    const moduleId = registry?.activeModuleId ?? null;
    attachTimeline(
      store,
      activeProject == null
        ? undefined
        : { persistence: timelinePersistence(activeProject.id, moduleId) },
    );
  }, [store, activeProject, registry, timelinePersistence]);

  useEffect(() => {
    resetPresentation();
    applySnapshot(shown, getSnapshot(store));
    return attachPresentation(shown, store);
  }, [store, shown]);

  // Never leave recent timeline nodes or project changes unsaved when the
  // tab goes away.
  useEffect(() => {
    const handleBeforeUnload = () => {
      pendingSaveFlushRef.current?.();
      flushTimeline();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () =>
      window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  const consumeOverviewSeed = useCallback((projectId: string): string | null => {
    const pending = pendingOverviewSeedRef.current;
    if (pending == null || pending.projectId !== projectId) return null;
    pendingOverviewSeedRef.current = null;
    return pending.seed;
  }, []);

  const selectProject = useCallback(
    (id: string, name: string, options?: { overviewSeed?: string }) => {
      // Finish the outgoing project's writes before anything is replaced.
      pendingSaveFlushRef.current?.();
      flushTimeline();

      const data = loadProjectData(id);
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

      const openStore = (
        created: Store,
        nextRegistry: ModuleRegistry,
        moduleId: string,
      ) => {
        resetPresentation();
        attachTimeline(created, {
          persistence: timelinePersistence(id, moduleId),
        });
        applyRegistry({ ...nextRegistry, activeModuleId: moduleId });
        setStore(created);
      };

      if (loadedRegistry != null) {
        try {
          const entry = pickActiveModule(loadedRegistry);
          openStore(createModuleStore(entry.snapshot), loadedRegistry, entry.id);
          setPersistenceError(failure);
        } catch (error) {
          console.error("Stored project data is invalid.", error);
          openStore(Store.create({ productOverview: {} }), createEmptyRegistry(), LEGACY_MODULE_ID);
          setPersistenceError(
            failure ?? "The stored project was invalid, so a blank project was opened.",
          );
        }
      } else {
        openStore(Store.create({ productOverview: {} }), createEmptyRegistry(), LEGACY_MODULE_ID);
        setPersistenceError(failure);
      }
      setActiveProject({ id, name });
      const seed = options?.overviewSeed?.trim();
      if (seed != null && seed.length > 0) {
        pendingOverviewSeedRef.current = { projectId: id, seed };
      }
    },
    [timelinePersistence, applyRegistry],
  );

  const backToProjects = useCallback(() => {
    pendingSaveFlushRef.current?.();
    flushTimeline();
    pendingOverviewSeedRef.current = null;
    applyRegistry(null);
    setActiveProject(null);
    setPersistenceError(null);
  }, [applyRegistry]);

  const clearPersistenceError = useCallback(() => {
    setPersistenceError(null);
  }, []);

  const enableModules = useCallback(
    (name: string): void => {
      const current = registryRef.current;
      if (current == null || current.modulesEnabled) return;
      const trimmed = normalizeModuleName(name);
      assertModuleNameAvailable(trimmed, current.modules);
      applyRegistry({
        ...current,
        modulesEnabled: true,
        modules: current.modules.map((entry) =>
          entry.id === current.activeModuleId ? { ...entry, name: trimmed } : entry,
        ),
      });
    },
    [applyRegistry],
  );

  const switchModule = useCallback(
    (id: string): boolean => {
      const current = registryRef.current;
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
      pendingSaveFlushRef.current?.();
      flushTimeline();
      const stashed = current.modules.map((entry) =>
        entry.id === current.activeModuleId
          ? { ...entry, snapshot: getSnapshot(store) as unknown as Record<string, unknown> }
          : entry,
      );
      applyRegistry({ ...current, activeModuleId: id, modules: stashed });
      setStore(created);
      return true;
    },
    [store, applyRegistry],
  );

  const addModule = useCallback(
    (name: string): void => {
      const current = registryRef.current;
      if (current == null) return;
      const trimmed = normalizeModuleName(name);
      assertModuleNameAvailable(trimmed, current.modules);
      pendingSaveFlushRef.current?.();
      flushTimeline();
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
          ? { ...module, snapshot: getSnapshot(store) as unknown as Record<string, unknown> }
          : module,
      );
      applyRegistry({ ...current, activeModuleId: entry.id, modules: [...stashed, entry] });
      setStore(created);
    },
    [store, applyRegistry],
  );

  const archiveModule = useCallback(
    (id: string): void => {
      const current = registryRef.current;
      if (current == null || id === current.activeModuleId) return;
      const target = current.modules.find((entry) => entry.id === id);
      if (target == null || target.archivedAt != null) return;
      if (visibleModules(current).length <= 1) return;
      applyRegistry({
        ...current,
        modules: current.modules.map((entry) =>
          entry.id === id ? { ...entry, archivedAt: new Date().toISOString() } : entry,
        ),
      });
    },
    [applyRegistry],
  );

  const recordOpenStep = useCallback(
    (step: WorkflowStage): void => {
      const current = registryRef.current;
      // Open steps are module-mode state: while modules are off the hidden
      // legacy entry keeps opening at the first stage, so enabling later
      // starts there rather than wherever tabbing left off.
      if (current == null || !current.modulesEnabled) return;
      const active = current.modules.find(
        (entry) => entry.id === current.activeModuleId,
      );
      if (active == null || active.openStep === step) return;
      applyRegistry({
        ...current,
        modules: current.modules.map((entry) =>
          entry.id === current.activeModuleId ? { ...entry, openStep: step } : entry,
        ),
      });
    },
    [applyRegistry],
  );

  /** Every visible module, backed by its live or sibling store. */
  const collectExportModules = useCallback(
    (currentRegistry: ModuleRegistry): ExportModule[] => {
      const modules: ExportModule[] = [];
      for (const entry of visibleModules(currentRegistry)) {
        const name = currentRegistry.modulesEnabled ? entry.name : null;
        if (entry.id === currentRegistry.activeModuleId) {
          modules.push({ id: entry.id, name, store });
          continue;
        }
        const sibling = siblingStoreFor(currentRegistry, entry);
        if (sibling != null) modules.push({ id: entry.id, name, store: sibling });
      }
      return modules;
    },
    [store, siblingStoreFor],
  );

  const exportProject = useCallback(
    async (format: ProjectExportFormat): Promise<void> => {
      const currentRegistry = registryRef.current;
      if (currentRegistry == null) return;
      const modules = collectExportModules(currentRegistry);
      if (format === "json") {
        exportProjectJson(
          currentRegistry,
          getSnapshot(store) as unknown as Record<string, unknown>,
        );
        return;
      }
      if (format === "pdf") {
        await exportProjectPdf(modules);
        return;
      }
      exportProjectText(modules);
    },
    [store, collectExportModules],
  );

  const reportExportError = useCallback(
    (message: string) => {
      store.setValidationErrors({ validationErrors: message });
      setTimeout(() => store.resetValidationErrors(), 3000);
    },
    [store],
  );

  const exportCodeArchive = useCallback(
    (format: CodeArchiveFormat): void => {
      const currentRegistry = registryRef.current;
      if (currentRegistry == null) return;
      void runCodeArchiveExport(
        format,
        { activeStore: store, modules: collectExportModules(currentRegistry) },
        reportExportError,
      );
    },
    [store, collectExportModules, reportExportError],
  );

  const importProjectFile = useCallback(
    (data: unknown): void => {
      if (activeProject == null) return;
      // Drop any pending write of the outgoing state; the import replaces it.
      pendingSaveFlushRef.current?.();
      flushTimeline();
      const payload = parseProjectPayload(data);
      // Every module passes through the validation gate before storage.
      for (const entry of payload.modules) {
        createModuleStore(entry.snapshot);
      }
      saveProjectData(activeProject.id, payload);
      selectProject(activeProject.id, activeProject.name);
    },
    [activeProject, selectProject],
  );

  const activeEntry =
    registry == null
      ? null
      : registry.modules.find((entry) => entry.id === registry.activeModuleId) ?? null;
  const codeExportAvailable =
    registry != null &&
    registry.modules.some((entry) => {
      if (entry.archivedAt != null) return false;
      if (entry.id === registry.activeModuleId) return store.hasGeneratedScaffold;
      const files = Array.isArray(entry.snapshot.scaffoldFiles)
        ? entry.snapshot.scaffoldFiles.length
        : 0;
      return hasGeneratedScaffoldIn(entry.snapshot.projectSetup, files);
    });

  const contextValue: ProjectContextValue = {
    activeProject,
    persistenceError,
    selectProject,
    consumeOverviewSeed,
    backToProjects,
    clearPersistenceError,
    modules:
      registry == null
        ? []
        : visibleModules(registry).map((entry) => ({
            id: entry.id,
            name: entry.name,
            active: entry.id === registry.activeModuleId,
          })),
    modulesEnabled: registry?.modulesEnabled ?? false,
    activeModuleId: registry?.activeModuleId ?? "",
    activeModuleOpenStep: activeEntry?.openStep ?? WorkflowStage.ProductOverview,
    codeExportAvailable,
    enableModules,
    addModule,
    switchModule,
    archiveModule,
    recordOpenStep,
    importProjectFile,
    exportProject,
    exportCodeArchive,
  };

  return (
    <projectContext.Provider value={contextValue}>
      <storeContext.Provider value={store}>
        <presentationStoreContext.Provider value={shown}>
          <AppRouterCacheProvider options={{}}>
            <ThemeProvider theme={theme}>
              <DefaultPropsProvider
                value={{
                  MuiLink: { component: Link },
                  MuiButtonBase: { LinkComponent: Link },
                  MuiTab: { LinkComponent: Link },
                }}
              >
                {children}
                <NoticeHost />
              </DefaultPropsProvider>
            </ThemeProvider>
          </AppRouterCacheProvider>
        </presentationStoreContext.Provider>
      </storeContext.Provider>
    </projectContext.Provider>
  );
}
