"use client";
import Button from "@mui/material/Button";
import DefaultPropsProvider from "@mui/material/DefaultPropsProvider";
import { ThemeProvider } from "@mui/material/styles";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v15-appRouter";
import { saveAs } from "file-saver";
import { memo, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { installAiRuntime } from "ai-agent/runtime";
import Link from "components/Link";
import { NoticeHost } from "components/NoticeHost";
import PersistentAlert from "components/PersistentAlert";
import { connectWebSocket, linkInProcess, linkUrlFor } from "connection";
import { PROJECT_HOST_LOCATION } from "deployment";
import { browserAiSettings } from "lib/aiSettingsStorage";
import { webPersistence } from "persistence";
import { type ConnectionStatus, ProjectClient } from "project-client";
import { ProjectHost } from "project-host";
import { moduleSummaries, ProjectSession } from "project-session";
import { type ExportOptions, type ListedRestorePoint, webProjectAuthority } from "storage-and-recovery";
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

/** The page's IANA time zone, whose calendar the host keeps restore points by. */
function pageTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function connectProject(): ProjectConnection {
  if (PROJECT_HOST_LOCATION === "server") {
    return {
      session: null,
      client: new ProjectClient(() => connectWebSocket(linkUrlFor(window.location.href)), { timeZone: pageTimeZone() }),
    };
  }
  installAiRuntime(browserAiSettings);
  // Every tab builds its own host; the lock makes one of them the project's writer.
  const session = new ProjectSession(webPersistence, { authority: webProjectAuthority });
  const host = new ProjectHost(session);
  return { session, client: new ProjectClient(() => linkInProcess(host), { timeZone: pageTimeZone() }) };
}

/** The name of an export's file: the project's, and for a restore point its name or that it was automatic, and when it was made. */
function exportFileName(projectName: string, restorePoint?: ListedRestorePoint): string {
  if (restorePoint == null) return `${projectName}.json`;
  const at = new Date(restorePoint.at);
  const twoDigits = (value: number): string => String(value).padStart(2, "0");
  const date = `${at.getFullYear()}-${twoDigits(at.getMonth() + 1)}-${twoDigits(at.getDate())}`;
  const time = `${twoDigits(at.getHours())}.${twoDigits(at.getMinutes())}`;
  return `${projectName}, ${restorePoint.name ?? "automatic restore point"} ${date} ${time}.json`;
}

let isStoreReloadNeeded = true;

/**
 * Values the providers below hand to every component that reads them, made
 * once: a new object on each render would render every reader again.
 */
const CACHE_OPTIONS = {};
const DEFAULT_PROPS = {
  MuiLink: { component: Link },
  MuiButtonBase: { LinkComponent: Link },
  MuiTab: { LinkComponent: Link },
};

/**
 * The theme, style cache and default props around the page. Memoized, so a
 * new session snapshot renders only the contexts that changed, not every
 * component under these providers.
 */
const PageShell = memo(function PageShell({
  children,
  connection,
}: {
  children: React.ReactNode;
  connection: ConnectionStatus;
}) {
  return (
    <AppRouterCacheProvider options={CACHE_OPTIONS}>
      <ThemeProvider theme={theme}>
        <DefaultPropsProvider value={DEFAULT_PROPS}>
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
  );
});

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
  const history = sessionState.status === "ready" ? sessionState.history : null;
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

  const exportProject = useCallback(
    async (options: ExportOptions, restorePoint?: ListedRestorePoint): Promise<void> => {
      if (projectName == null) return;
      const contents = await client.exportProject(options, restorePoint?.id);
      saveAs(new Blob([contents], { type: "application/json" }), exportFileName(projectName, restorePoint));
    },
    [client, projectName],
  );

  const contextValue = useMemo((): ProjectContextValue => ({
    status,
    activeProject,
    persistenceError,
    outsideChange,
    openChangedProject: client.openChangedProject,
    keepShownProject: client.keepShownProject,
    leaveProjectRemoved: client.leaveProjectRemoved,
    history,
    undo: client.undo,
    redo: client.redo,
    listSteps: client.listSteps,
    bringBackStep: client.bringBackStep,
    listRestorePoints: client.listRestorePoints,
    makeRestorePoint: client.makeRestorePoint,
    restoreToRestorePoint: client.restoreToRestorePoint,
    pinRestorePoint: client.pinRestorePoint,
    unpinRestorePoint: client.unpinRestorePoint,
    deleteRestorePoint: client.deleteRestorePoint,
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
  }), [client, status, activeProject, persistenceError, outsideChange, history, storage, registry, exportProject]);

  return (
    <projectContext.Provider value={contextValue}>
      <storeContext.Provider value={store}>
        <PageShell connection={connection}>{children}</PageShell>
      </storeContext.Provider>
    </projectContext.Provider>
  );
}
