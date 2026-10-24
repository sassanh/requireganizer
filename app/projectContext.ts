"use client";
import { createContext, useContext } from "react";

import type { CodeArchiveFormat, ProjectExportFormat } from "lib/projectExport";
import type { PersistenceAdapter, StorageTraits } from "persistence";
import type { TimelineClient } from "project-client";
import type { ModuleSummary, ProjectSessionStatus } from "project-session";
import type { WorkflowStage } from "store/constants";

/**
 * The open project as the interface sees it. Every operation is a request to
 * the project host and settles once the host has applied it and this page's
 * replica shows the result.
 */
export interface ProjectContextValue {
  status: ProjectSessionStatus;
  activeProject: { id: string, name: string } | null;
  persistenceError: string | null;
  /** The model that reviews drafts; null when auto review is unavailable. */
  reviewerModel: string | null;
  /** How to configure a reviewer model, shown while there is none. */
  missingReviewerModelMessage: string;
  /** The storage behind the host: whether it holds one project, and its name. */
  storage: StorageTraits;
  /** The host's storage, for the project list and other stored records. */
  persistence: PersistenceAdapter;
  timeline: TimelineClient;
  /** A starting intent drafts the overview once the project opens. */
  selectProject: (id: string, name: string, options?: { overviewSeed?: string }) => Promise<void>;
  backToProjects: () => Promise<void>;
  clearPersistenceError: () => Promise<void>;
  /** Visible modules of the open project, in creation order. */
  modules: ModuleSummary[];
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

export const projectContext = createContext<ProjectContextValue | null>(null);

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

/** The open project's id; null outside a project page, where links into it make no sense. */
export const useOpenProjectId = (): string | null =>
  useContext(projectContext)?.activeProject?.id ?? null;
