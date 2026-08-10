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
} from "screens/ProjectSelector";
import { Store, storeContext } from "store";

import { theme } from "./theme";

interface ProjectContextValue {
  activeProject: { id: string, name: string } | null;
  selectProject: (id: string, name: string) => void;
  backToProjects: () => void;
}

const projectContext = createContext<ProjectContextValue>({
  activeProject: null,
  selectProject: () => { },
  backToProjects: () => { },
});

export const useProject = () => useContext(projectContext);

let isStoreReloadNeeded = true;

export default function Providers({ children }: { children: React.ReactNode }) {
  const [activeProject, setActiveProject] = useState<{ id: string, name: string } | null>(null);
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
      saveProjectData(activeProject.id, snapshot);

      const projects = getProjectsIndex();
      const idx = projects.findIndex((p) => p.id === activeProject.id);
      if (idx >= 0) {
        projects[idx].description =
          (snapshot as { description?: string }).description?.slice(0, 200) ??
          "";
        projects[idx].updatedAt = new Date().toISOString();
        saveProjectsIndex(projects);
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
      setStore(Store.create(snapshot));
      isStoreReloadNeeded = false;
    }
  }, [store]);

  const selectProject = useCallback(
    (id: string, name: string) => {
      const data = loadProjectData(id);
      if (data) {
        try {
          setStore(Store.create(data as Parameters<typeof Store.create>[0]));
        } catch {
          // If snapshot is corrupted, start fresh
          setStore(Store.create({ productOverview: {} }));
        }
      } else {
        setStore(Store.create({ productOverview: {} }));
      }
      setActiveProject({ id, name });
    },
    [],
  );

  const backToProjects = useCallback(() => {
    setActiveProject(null);
  }, []);

  return (
    <projectContext.Provider value={{ activeProject, selectProject, backToProjects }}>
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
