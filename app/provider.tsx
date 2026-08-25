"use client";
import DefaultPropsProvider from "@mui/material/DefaultPropsProvider";
import { ThemeProvider } from "@mui/material/styles";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v15-appRouter";
import { getSnapshot, onSnapshot } from "mobx-state-tree";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

import { setAgentSessionId } from "ai-agent/agent";
import Link from "components/Link";
import {
  getProjectsIndex,
  loadProjectData,
  loadTimelineData,
  saveProjectData,
  saveProjectsIndex,
  saveTimelineData,
} from "lib/projectStorage";
import { Store, storeContext } from "store";
import { attachTimeline, flushTimeline } from "store/timeline/controller";

import { theme } from "./theme";

interface ProjectContextValue {
  activeProject: { id: string, name: string } | null;
  persistenceError: string | null;
  selectProject: (id: string, name: string) => void;
  backToProjects: () => void;
  clearPersistenceError: () => void;
}

const projectContext = createContext<ProjectContextValue>({
  activeProject: null,
  persistenceError: null,
  selectProject: () => { },
  backToProjects: () => { },
  clearPersistenceError: () => { },
});

export const useProject = () => useContext(projectContext);

let isStoreReloadNeeded = true;

const PROJECT_SAVE_DEBOUNCE_MS = 800;

export default function Providers({ children }: { children: React.ReactNode }) {
  const [activeProject, setActiveProject] = useState<{ id: string, name: string } | null>(null);
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const [store, setStore] = useState(() => {
    isStoreReloadNeeded = false;
    const initialStore = Store.create({ productOverview: {} });
    attachTimeline(initialStore);
    return initialStore;
  });

  const disposerRef = useRef<(() => void) | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveFlushRef = useRef<(() => void) | null>(null);

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
      pendingWrite = () => {
        try {
          saveProjectData(activeProject.id, snapshot);

          const projects = getProjectsIndex();
          const index = projects.findIndex((project) => project.id === activeProject.id);
          if (index >= 0) {
            projects[index].description = snapshot.description.slice(0, 200);
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
  }, [store, activeProject]);

  useEffect(() => {
    if (isStoreReloadNeeded) {
      const snapshot = getSnapshot(store);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional one-time store reload
      setStore(Store.create(snapshot));
      isStoreReloadNeeded = false;
    }
  }, [store]);

  // Every store instance that becomes the active one gets the timeline.
  // Instances tied to a project persist their timeline in that project's
  // storage; the scratch store before a project is opened stays session-only.
  const timelinePersistence = useCallback(
    (projectId: string | null) => {
      if (projectId == null) return undefined;
      return {
        load: () => loadTimelineData(projectId),
        save: (data: unknown) => saveTimelineData(projectId, data),
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
    attachTimeline(
      store,
      activeProject == null
        ? undefined
        : { persistence: timelinePersistence(activeProject.id) },
    );
  }, [store, activeProject, timelinePersistence]);

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

  const selectProject = useCallback(
    (id: string, name: string) => {
      const data = loadProjectData(id);
      const openStore = (created: typeof store) => {
        attachTimeline(created, {
          persistence: timelinePersistence(id),
        });
        setStore(created);
      };
      if (data) {
        try {
          const loadedStore = Store.create({ productOverview: {} });
          loadedStore.import(data);
          openStore(loadedStore);
          setPersistenceError(null);
        } catch (error) {
          console.error("Stored project data is invalid.", error);
          openStore(Store.create({ productOverview: {} }));
          setPersistenceError(
            "The stored project was invalid, so a blank project was opened.",
          );
        }
      } else {
        openStore(Store.create({ productOverview: {} }));
        setPersistenceError(null);
      }
      setActiveProject({ id, name });
    },
    [timelinePersistence],
  );

  const backToProjects = useCallback(() => {
    setActiveProject(null);
    setPersistenceError(null);
  }, []);

  const clearPersistenceError = useCallback(() => {
    setPersistenceError(null);
  }, []);

  return (
    <projectContext.Provider
      value={{
        activeProject,
        persistenceError,
        selectProject,
        backToProjects,
        clearPersistenceError,
      }}
    >
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
            </DefaultPropsProvider>
          </ThemeProvider>
        </AppRouterCacheProvider>
      </storeContext.Provider>
    </projectContext.Provider>
  );
}
