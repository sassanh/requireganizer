"use client";
import { createContext, useContext } from "react";

import type { ProjectIdentity } from "lib/projectStorage";
import type { ClientPersistence, OutsideChange, StorageTraits } from "persistence";
import type { ModuleSummary, ProjectSessionStatus } from "project-session";

/**
 * The open project as the interface sees it. Every operation is a request to
 * the project host and settles once the host has applied it and this page's
 * replica shows the result.
 */
export interface ProjectContextValue {
  status: ProjectSessionStatus;
  activeProject: ProjectIdentity | null;
  persistenceError: string | null;
  /** How the stored project changed outside Requireganizer; null while it has not. */
  outsideChange: OutsideChange | null;
  /** Open the project as storage now holds it. */
  openChangedProject: () => Promise<void>;
  /** Write the shown project over the changed one. */
  keepShownProject: () => Promise<void>;
  /** The storage behind the host: whether it holds one project, and its name. */
  storage: StorageTraits;
  /** The host's storage, for the project list. */
  persistence: ClientPersistence;
  /** A starting intent drafts the overview once the project opens. */
  selectProject: (id: string, name: string, options?: { overviewSeed?: string }) => Promise<void>;
  /** Open here the project another tab holds. */
  takeOverProject: () => Promise<void>;
  backToProjects: () => Promise<void>;
  clearPersistenceError: () => Promise<void>;
  /** Visible modules of the open project, in creation order. */
  modules: ModuleSummary[];
  modulesEnabled: boolean;
  activeModuleId: string;
  /** Rejects when the name is empty or taken. */
  enableModules: (name: string) => Promise<void>;
  /** Rejects when the name is empty or taken. */
  addModule: (name: string) => Promise<void>;
  /** False when the id names no openable module (unknown or archived). */
  switchModule: (id: string) => Promise<boolean>;
  archiveModule: (id: string) => Promise<void>;
  /** Rejects when the name is empty, invalid, or taken. */
  renameModule: (id: string, name: string) => Promise<void>;
  /** Rejects when the name is empty or taken. */
  renameProject: (name: string) => Promise<void>;
  /** Rejects when the name is empty or taken. */
  createProject: (name: string) => Promise<ProjectIdentity>;
  /** Rejects with what is wrong with the file. */
  importNewProject: (data: unknown, fileName: string) => Promise<ProjectIdentity>;
  /** Rejects with what is wrong with the file, changing nothing. */
  importProjectFile: (data: unknown) => Promise<void>;
  /** Save the project as a JSON file. */
  exportProject: () => Promise<void>;
}

export const projectContext = createContext<ProjectContextValue | null>(null);

export const useProject = (): ProjectContextValue => {
  const value = useContext(projectContext);
  if (value == null) {
    throw new Error("useProject must be used inside Providers.");
  }
  return value;
};

/** The host's storage, reached through the project connection. */
export const usePersistence = (): ClientPersistence =>
  useProject().persistence;

/** The open project's id; null outside a project page, where links into it make no sense. */
export const useOpenProjectId = (): string | null =>
  useContext(projectContext)?.activeProject?.id ?? null;
