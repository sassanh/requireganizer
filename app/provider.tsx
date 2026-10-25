"use client";
import Button from "@mui/material/Button";
import DefaultPropsProvider from "@mui/material/DefaultPropsProvider";
import { ThemeProvider } from "@mui/material/styles";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v15-appRouter";
import { applySnapshot, getSnapshot } from "mobx-state-tree";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { installAiRuntime } from "ai-agent/runtime";
import Link from "components/Link";
import { NoticeHost } from "components/NoticeHost";
import PersistentAlert from "components/PersistentAlert";
import { connectWebSocket, linkInProcess, linkUrlFor } from "connection";
import { PROJECT_HOST_LOCATION } from "deployment";
import { useUndoRedoKeyboardShortcuts } from "hooks/useUndoRedoKeyboardShortcuts";
import { browserAiSettings } from "lib/aiSettingsStorage";
import { activeModule } from "lib/moduleSchema";
import {
  type CodeArchiveFormat,
  exportCodeArchive as runCodeArchiveExport,
  type ExportModule,
  exportProjectJson,
  exportProjectPdf,
  exportProjectText,
  type ProjectExportFormat,
} from "lib/projectExport";
import { webPersistence } from "persistence";
import {
  attachPresentation,
  presentationStoreContext,
  resetPresentation,
} from "presentation";
import { ProjectClient } from "project-client";
import { ProjectHost } from "project-host";
import { moduleSummaries, ProjectSession } from "project-session";
import { hasGeneratedScaffoldIn, Store, storeContext } from "store";
import { WorkflowStage } from "store/constants";

import { projectContext, type ProjectContextValue } from "./projectContext";
import { theme } from "./theme";

/** One visible module as the interface sees it. */
export type { ModuleSummary } from "project-session";



/**
 * How this build reaches its project host. A page build runs the host in
 * this page, with browser storage and the page's AI settings, over the same
 * kind of link a server would serve; a server build connects to the server
 * that served the page.
 */
interface ProjectConnection {
  client: ProjectClient;
  /** The host's session, when it runs in this page. */
  session: ProjectSession | null;
}

function connectProject(): ProjectConnection {
  if (PROJECT_HOST_LOCATION === "server") {
    return {
      session: null,
      client: new ProjectClient(() => connectWebSocket(linkUrlFor(window.location.href))),
    };
  }
  installAiRuntime(browserAiSettings);
  const session = new ProjectSession(webPersistence);
  const host = new ProjectHost(session);
  return { session, client: new ProjectClient(() => linkInProcess(host)) };
}

let isStoreReloadNeeded = true;

export default function Providers({ children }: { children: React.ReactNode }) {
  const [{ session, client }] = useState(() => {
    isStoreReloadNeeded = false;
    return connectProject();
  });
  useUndoRedoKeyboardShortcuts(client.timeline);
  const sessionState = useSyncExternalStore(
    client.subscribe,
    client.getSnapshot,
    client.getSnapshot,
  );
  const { status, activeProject, persistenceError, outsideChange, registry, store } =
    sessionState;
  const { reviewerModel, missingReviewerModelMessage, storage } = useSyncExternalStore(
    client.subscribe,
    client.getHostInfo,
    client.getHostInfo,
  );
  const connection = useSyncExternalStore(
    client.subscribe,
    client.getConnectionStatus,
    client.getConnectionStatus,
  );
  const [shown] = useState(() => Store.create(getSnapshot(store)));

  useEffect(() => client.open(), [client]);

  useEffect(() => {
    if (session == null) return;
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
    if (session == null) return;
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

  const activeEntry = registry == null ? null : activeModule(registry);
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
    outsideChange,
    openChangedProject: client.openChangedProject,
    keepShownProject: client.keepShownProject,
    reviewerModel,
    missingReviewerModelMessage,
    storage,
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
                {connection.state === "reconnecting" && (
                  <PersistentAlert severity="warning">{connection.message}</PersistentAlert>
                )}
                {connection.state === "failed" && (
                  <PersistentAlert severity="error">
                    {connection.message}{" "}
                    <Button color="inherit" size="small" onClick={() => window.location.reload()}>
                      Reload
                    </Button>
                  </PersistentAlert>
                )}
              </DefaultPropsProvider>
            </ThemeProvider>
          </AppRouterCacheProvider>
        </presentationStoreContext.Provider>
      </storeContext.Provider>
    </projectContext.Provider>
  );
}
