"use client";
import DefaultPropsProvider from "@mui/material/DefaultPropsProvider";
import { ThemeProvider } from "@mui/material/styles";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v15-appRouter";
import { applySnapshot, getSnapshot } from "mobx-state-tree";
import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore } from "react";

import { setAgentSessionId } from "ai-agent/agent";
import Link from "components/Link";
import { NoticeHost } from "components/NoticeHost";
import { useUndoRedoKeyboardShortcuts } from "hooks/useUndoRedoKeyboardShortcuts";
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
  type PersistenceAdapter,
  webPersistence,
} from "persistence";
import {
  attachPresentation,
  presentationStoreContext,
  resetPresentation,
} from "presentation";
import {
  moduleSummaries,
  ProjectSession,
  type ProjectSessionStatus,
} from "project-session";
import { hasGeneratedScaffoldIn, Store, storeContext } from "store";
import { WorkflowStage } from "store/constants";

import { theme } from "./theme";

/** One visible module as the interface sees it. */
export type { ModuleSummary } from "project-session";

interface ProjectContextValue {
  status: ProjectSessionStatus;
  activeProject: { id: string, name: string } | null;
  persistenceError: string | null;
  /** The one storage adapter every component and the session use. */
  persistence: PersistenceAdapter;
  selectProject: (id: string, name: string, options?: { overviewSeed?: string }) => void;
  consumeOverviewSeed: (projectId: string) => string | null;
  backToProjects: () => void;
  clearPersistenceError: () => void;
  /** Visible modules of the open project, in creation order. */
  modules: ReturnType<typeof moduleSummaries>;
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
  importProjectFile: (data: unknown) => Promise<void>;
  exportProject: (format: ProjectExportFormat) => Promise<void>;
  exportCodeArchive: (format: CodeArchiveFormat) => void;
}

const projectContext = createContext<ProjectContextValue | null>(null);

export const useProject = (): ProjectContextValue => {
  const value = useContext(projectContext);
  if (value == null) {
    throw new Error("useProject must be used inside Providers.");
  }
  return value;
};

/** The shared storage adapter exposed by the session. */
export const usePersistence = (): PersistenceAdapter =>
  useProject().persistence;

let isStoreReloadNeeded = true;

export default function Providers({ children }: { children: React.ReactNode }) {
  useUndoRedoKeyboardShortcuts();
  const [session] = useState(() => {
    isStoreReloadNeeded = false;
    return new ProjectSession(webPersistence);
  });
  const sessionState = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
  const { status, activeProject, persistenceError, registry, store } =
    sessionState;
  const [shown] = useState(() => Store.create(getSnapshot(store)));

  useEffect(() => {
    if (isStoreReloadNeeded) {
      resetPresentation();
      session.reloadStore();
      isStoreReloadNeeded = false;
    }
    session.start();
    return () => session.dispose();
  }, [session]);

  // A stable per-project session id gives the provider's prompt cache a
  // consistent affinity key for every LLM request of this project.
  useEffect(() => {
    setAgentSessionId(activeProject?.id ?? null);
  }, [activeProject]);

  useEffect(() => {
    resetPresentation();
    applySnapshot(shown, getSnapshot(store));
    return attachPresentation(shown, store);
  }, [store, shown]);

  // Never leave recent timeline nodes or project changes unsaved when the
  // tab goes away.
  useEffect(() => {
    const handleBeforeUnload = () => {
      session.flush();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () =>
      window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [session]);

  const exportProject = useCallback(
    async (format: ProjectExportFormat): Promise<void> => {
      if (registry == null) return;
      const modules: ExportModule[] = session.getExportModules();
      if (format === "json") {
        exportProjectJson(
          registry,
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
    [registry, session, store],
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
      if (registry == null) return;
      void runCodeArchiveExport(
        format,
        { activeStore: store, modules: session.getExportModules() },
        reportExportError,
      );
    },
    [registry, session, store, reportExportError],
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
    status,
    activeProject,
    persistenceError,
    persistence: session.persistence,
    selectProject: session.selectProject,
    consumeOverviewSeed: session.consumeOverviewSeed,
    backToProjects: session.backToProjects,
    clearPersistenceError: session.clearPersistenceError,
    modules: moduleSummaries(registry),
    modulesEnabled: registry?.modulesEnabled ?? false,
    activeModuleId: registry?.activeModuleId ?? "",
    activeModuleOpenStep: activeEntry?.openStep ?? WorkflowStage.ProductOverview,
    codeExportAvailable,
    enableModules: session.enableModules,
    addModule: session.addModule,
    switchModule: session.switchModule,
    archiveModule: session.archiveModule,
    recordOpenStep: session.recordOpenStep,
    importProjectFile: session.importProjectFile,
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
