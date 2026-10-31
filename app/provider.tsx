"use client";
import Button from "@mui/material/Button";
import DefaultPropsProvider from "@mui/material/DefaultPropsProvider";
import { ThemeProvider } from "@mui/material/styles";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v15-appRouter";
import { saveAs } from "file-saver";
import { getSnapshot } from "mobx-state-tree";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { installAiRuntime } from "ai-agent/runtime";
import Link from "components/Link";
import { NoticeHost } from "components/NoticeHost";
import PersistentAlert from "components/PersistentAlert";
import { connectWebSocket, linkInProcess, linkUrlFor } from "connection";
import { PROJECT_HOST_LOCATION } from "deployment";
import { browserAiSettings } from "lib/aiSettingsStorage";
import { activeModule, buildProjectPayload, FIRST_STAGE } from "lib/moduleSchema";
import { webPersistence } from "persistence";
import { ProjectClient } from "project-client";
import { ProjectHost } from "project-host";
import { moduleSummaries, ProjectSession } from "project-session";
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
  const sessionState = useSyncExternalStore(
    client.subscribe,
    client.getSnapshot,
    client.getSnapshot,
  );
  const { status, activeProject, persistenceError, outsideChange, registry, store } =
    sessionState;
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
  // the tab goes away.
  useEffect(() => {
    if (session == null) return;
    const handleBeforeUnload = () => {
      session.flush();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () =>
      window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [session]);

  const exportProject = useCallback((): void => {
    if (registry == null || activeProject == null) return;
    const payload = buildProjectPayload(registry, getSnapshot(store) as unknown as Record<string, unknown>);
    saveAs(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }), `${activeProject.name}.json`);
  }, [registry, activeProject, store]);

  const activeEntry = registry == null ? null : activeModule(registry);
  const contextValue: ProjectContextValue = {
    status,
    activeProject,
    persistenceError,
    outsideChange,
    openChangedProject: client.openChangedProject,
    keepShownProject: client.keepShownProject,
    storage,
    persistence: client.persistence,
    selectProject: client.selectProject,
    backToProjects: client.backToProjects,
    clearPersistenceError: client.clearPersistenceError,
    modules: moduleSummaries(registry),
    modulesEnabled: registry?.modulesEnabled ?? false,
    activeModuleId: registry?.activeModuleId ?? "",
    activeModuleOpenStep: activeEntry?.openStep ?? FIRST_STAGE,
    enableModules: client.enableModules,
    addModule: client.addModule,
    switchModule: client.switchModule,
    archiveModule: client.archiveModule,
    renameModule: client.renameModule,
    renameProject: client.renameProject,
    recordOpenStep: client.recordOpenStep,
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
