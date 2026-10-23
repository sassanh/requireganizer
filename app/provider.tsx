"use client";
import DefaultPropsProvider from "@mui/material/DefaultPropsProvider";
import { ThemeProvider } from "@mui/material/styles";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v15-appRouter";
import { applySnapshot, getSnapshot } from "mobx-state-tree";
import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore } from "react";

import Link from "components/Link";
import { NoticeHost } from "components/NoticeHost";
import { linkInProcess } from "connection";
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
import { ProjectClient, type TimelineClient } from "project-client";
import { ProjectHost } from "project-host";
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

/**
 * The open project as the interface sees it. Every operation is a request to
 * the project host and settles once the host has applied it and this page's
 * replica shows the result.
 */
interface ProjectContextValue {
  status: ProjectSessionStatus;
  activeProject: { id: string, name: string } | null;
  persistenceError: string | null;
  /** The host's storage, for the project list and other stored records. */
  persistence: PersistenceAdapter;
  timeline: TimelineClient;
  /** A starting intent drafts the overview once the project opens. */
  selectProject: (id: string, name: string, options?: { overviewSeed?: string }) => Promise<void>;
  backToProjects: () => Promise<void>;
  clearPersistenceError: () => Promise<void>;
  /** Visible modules of the open project, in creation order. */
  modules: ReturnType<typeof moduleSummaries>;
  modulesEnabled: boolean;
  activeModuleId: string;
  /** The stage the active module last showed; reopening restores it. */
  activeModuleOpenStep: WorkflowStage;
  /** At least one visible module holds generated code. */
  codeExportAvailable: boolean;
  /** Rejects when the name is empty or taken. */
  enableModules: (name: string) => Promise<void>;
  /** Rejects when the name is empty or taken. */
  addModule: (name: string) => Promise<void>;
  /** False when the id names no openable module (unknown or archived). */
  switchModule: (id: string) => Promise<boolean>;
  archiveModule: (id: string) => Promise<void>;
  recordOpenStep: (step: WorkflowStage) => Promise<void>;
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

/** The host's storage adapter, reached through the project connection. */
export const usePersistence = (): PersistenceAdapter =>
  useProject().persistence;

/** The open module's history and the moves through it. */
export const useTimeline = (): TimelineClient => useProject().timeline;

/**
 * The web mode: the project host runs in this page, with web storage, and
 * the interface reaches it through the same kind of link a local process
 * would serve.
 */
interface InPageProject {
  session: ProjectSession;
  client: ProjectClient;
}

function createInPageProject(): InPageProject {
  const session = new ProjectSession(webPersistence);
  const host = new ProjectHost(session);
  return { session, client: new ProjectClient(() => linkInProcess(host)) };
}

let isStoreReloadNeeded = true;

export default function Providers({ children }: { children: React.ReactNode }) {
  const [{ session, client }] = useState(() => {
    isStoreReloadNeeded = false;
    return createInPageProject();
  });
  useUndoRedoKeyboardShortcuts(client.timeline);
  const sessionState = useSyncExternalStore(
    client.subscribe,
    client.getSnapshot,
    client.getSnapshot,
  );
  const { status, activeProject, persistenceError, registry, store } =
    sessionState;
  const [shown] = useState(() => Store.create(getSnapshot(store)));

  useEffect(() => client.open(), [client]);

  useEffect(() => {
    if (isStoreReloadNeeded) {
      resetPresentation();
      session.reloadStore();
      isStoreReloadNeeded = false;
    }
    session.start();
    return () => session.dispose();
  }, [session]);

  useEffect(() => {
    resetPresentation();
    applySnapshot(shown, getSnapshot(store));
    return attachPresentation(shown, store, client.changeSource);
  }, [store, shown, client]);

  // The host lives in this tab: never leave recent timeline nodes or
  // project changes unsaved when the tab goes away.
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
      const modules: ExportModule[] = client.getExportModules();
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
    [registry, client, store],
  );

  const reportExportError = useCallback(
    (message: string) => {
      void store.setValidationErrors({ validationErrors: message });
      setTimeout(() => void store.resetValidationErrors(), 3000);
    },
    [store],
  );

  const exportCodeArchive = useCallback(
    (format: CodeArchiveFormat): void => {
      if (registry == null) return;
      void runCodeArchiveExport(
        format,
        { activeStore: store, modules: client.getExportModules() },
        reportExportError,
      );
    },
    [registry, client, store, reportExportError],
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
    persistence: client.persistence,
    timeline: client.timeline,
    selectProject: client.selectProject,
    backToProjects: client.backToProjects,
    clearPersistenceError: client.clearPersistenceError,
    modules: moduleSummaries(registry),
    modulesEnabled: registry?.modulesEnabled ?? false,
    activeModuleId: registry?.activeModuleId ?? "",
    activeModuleOpenStep: activeEntry?.openStep ?? WorkflowStage.ProductOverview,
    codeExportAvailable,
    enableModules: client.enableModules,
    addModule: client.addModule,
    switchModule: client.switchModule,
    archiveModule: client.archiveModule,
    recordOpenStep: client.recordOpenStep,
    importProjectFile: client.importProjectFile,
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
