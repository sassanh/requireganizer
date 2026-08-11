"use client";
import DefaultPropsProvider from "@mui/material/DefaultPropsProvider";
import { ThemeProvider } from "@mui/material/styles";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v15-appRouter";
import { getSnapshot, onSnapshot } from "mobx-state-tree";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

import Link from "components/Link";
import {
  getProjectsIndex,
  loadProjectData,
  saveProjectData,
  saveProjectsIndex,
} from "lib/projectStorage";
import { Store, storeContext } from "store";

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

export default function Providers({ children }: { children: React.ReactNode }) {
  const [activeProject, setActiveProject] = useState<{ id: string, name: string } | null>(null);
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const [store, setStore] = useState(() => {
    isStoreReloadNeeded = false;
    return Store.create({ productOverview: {} });
  });

  const disposerRef = useRef<(() => void) | null>(null);

  // Auto-save store to localStorage whenever it changes
  useEffect(() => {
    disposerRef.current?.();
    disposerRef.current = null;

    if (!activeProject) return;

    disposerRef.current = onSnapshot(store, (snapshot) => {
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
    });

    return () => {
      disposerRef.current?.();
      disposerRef.current = null;
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

  const selectProject = useCallback(
    (id: string, name: string) => {
      const data = loadProjectData(id);
      if (data) {
        try {
          const loadedStore = Store.create({ productOverview: {} });
          loadedStore.import(data);
          setStore(loadedStore);
          setPersistenceError(null);
        } catch (error) {
          console.error("Stored project data is invalid.", error);
          setStore(Store.create({ productOverview: {} }));
          setPersistenceError(
            "The stored project was invalid, so a blank project was opened.",
          );
        }
      } else {
        setStore(Store.create({ productOverview: {} }));
        setPersistenceError(null);
      }
      setActiveProject({ id, name });
    },
    [],
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
