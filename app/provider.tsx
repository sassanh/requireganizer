"use client";
import Button from "@mui/material/Button";
import DefaultPropsProvider from "@mui/material/DefaultPropsProvider";
import { ThemeProvider } from "@mui/material/styles";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v15-appRouter";
import { saveAs } from "file-saver";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { installAiRuntime } from "ai-agent/runtime";
import Link from "components/Link";
import { NoticeHost } from "components/NoticeHost";
import PersistentAlert from "components/PersistentAlert";
import { connectWebSocket, linkInProcess, linkUrlFor } from "connection";
import { PROJECT_HOST_LOCATION } from "deployment";
import { browserAiSettings } from "lib/aiSettingsStorage";
import { webPersistence } from "persistence";
import { ProjectClient } from "project-client";
import { ProjectHost } from "project-host";
import { moduleSummaries, ProjectSession } from "project-session";
import { DEFAULT_EXPORT_OPTIONS, webProjectAuthority } from "storage-and-recovery";
import { storeContext } from "store";

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
  // Every tab builds its own host; the lock makes one of them the project's writer.
  const session = new ProjectSession(webPersistence, { authority: webProjectAuthority });
  const host = new ProjectHost(session);
  return { session, client: new ProjectClient(() => linkInProcess(host)) };
}

let isStoreReloadNeeded = true;

export default function Providers({ children }: { children: React.ReactNode }) {
  const [{ session, client }] = useState(() => {
    isStoreReloadNeeded = false;
    return connectProject();
  });
  const sessionState = useSyncExternalStore(
    client.subscribe,
    client.getSnapshot,
    client.getSnapshot,
  );
  const { status, activeProject, persistenceError, outsideChange, registry, store } =
    sessionState;
  const projectName = activeProject?.name ?? null;
  const { storage } = useSyncExternalStore(
    client.subscribe,
    client.getHostInfo,
    client.getHostInfo,
  );
  const connection = useSyncExternalStore(
    client.subscribe,
    client.getConnectionStatus,
    client.getConnectionStatus,
  );
  useEffect(() => client.open(), [client]);

  useEffect(() => {
    if (session == null) return;
    if (isStoreReloadNeeded) {
      session.reloadStore();
      isStoreReloadNeeded = false;
    }
    session.start();
    return () => session.dispose();
  }, [session]);

  // The host lives in this tab: never leave project changes unsaved when
  // the tab goes away. A hidden tab may be closed or discarded without
  // another event, and `pagehide` is the last one a closing tab gets.
  useEffect(() => {
    if (session == null) return;
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") session.flush();
    };
    const handlePageHide = () => session.flush();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [session]);

  const exportProject = useCallback(async (): Promise<void> => {
    if (projectName == null) return;
    const contents = await client.exportProject(DEFAULT_EXPORT_OPTIONS);
    saveAs(new Blob([contents], { type: "application/json" }), `${projectName}.json`);
  }, [client, projectName]);

  const contextValue: ProjectContextValue = {
    status,
    activeProject,
    persistenceError,
    outsideChange,
    openChangedProject: client.openChangedProject,
    keepShownProject: client.keepShownProject,
    history: sessionState.status === "ready" ? sessionState.history : null,
    undo: client.undo,
    redo: client.redo,
    listSteps: client.listSteps,
    bringBackStep: client.bringBackStep,
    storage,
    persistence: client.persistence,
    deleteProject: client.deleteProject,
    selectProject: client.selectProject,
    takeOverProject: client.takeOverProject,
    backToProjects: client.backToProjects,
    clearPersistenceError: client.clearPersistenceError,
    modules: moduleSummaries(registry),
    modulesEnabled: registry?.modulesEnabled ?? false,
    activeModuleId: registry?.activeModuleId ?? "",
    enableModules: client.enableModules,
    addModule: client.addModule,
    switchModule: client.switchModule,
    archiveModule: client.archiveModule,
    renameModule: client.renameModule,
    renameProject: client.renameProject,
    createProject: client.createProject,
    importNewProject: client.importNewProject,
    importProjectFile: client.importProjectFile,
    exportProject,
  };

  return (
    <projectContext.Provider value={contextValue}>
      <storeContext.Provider value={store}>
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
      </storeContext.Provider>
    </projectContext.Provider>
  );
}
