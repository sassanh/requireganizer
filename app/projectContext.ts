"use client";
import { createContext, useContext } from "react";

import type {
  FocusPlace,
  HistoryPosition,
  ListedRestorePoint,
  ListedSteps,
  PreviewTarget,
  StateDifference,
  StepListTarget,
} from "history";
import type { ProjectIdentity } from "lib/projectStorage";
import type { ClientPersistence, StorageTraits } from "persistence";
import type { ShownPreview } from "project-client";
import type { ModuleSummary, ProjectSessionStatus } from "project-session";
import type { ExportOptions, OutsideChange } from "storage";
import type { Store } from "store";
import type { SignatureFocusMove } from "workflow";

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
  /** Write the shown project over the changed or removed one. */
  keepShownProject: () => Promise<void>;
  /** Close the project removed outside Requireganizer and forget its history, writing nothing where it was. */
  leaveProjectRemoved: () => Promise<void>;
  /** Where the open project is in its history; null while no project is open or an earlier state is previewed. */
  history: HistoryPosition | null;
  /** Resolves to where the focus goes, or null to leave it where it is. */
  undo: () => Promise<FocusPlace | null>;
  redo: () => Promise<FocusPlace | null>;
  /** Every kept step, newest first, with what it added, changed or removed, then the start, before the oldest of them. */
  listSteps: () => Promise<ListedSteps>;
  /** Go to how the project was after a step or before the oldest of them, recording no step. */
  goTo: (target: StepListTarget) => Promise<void>;
  /** The kept restore points, newest first. */
  listRestorePoints: () => Promise<ListedRestorePoint[]>;
  /** What bringing back the project as it was after a kept step or at a restore point would add, change or remove. */
  differenceFromNow: (target: PreviewTarget) => Promise<StateDifference>;
  /** The earlier state the page shows, read only, in place of the project now; null while it shows the project now. */
  preview: ShownPreview | null;
  /** Show an earlier state in place of the project now; rejects, showing the project now, when it is no longer kept. */
  openPreview: (target: PreviewTarget) => Promise<void>;
  closePreview: () => void;
  /** Tell the project where the spec owner's focus is. */
  reportFocus: (place: FocusPlace | null) => void;
  /** Make a change that sends `move` with it; resolves to the unit the change moved the spec owner's focus to, null for none. */
  withFocusMove: (move: SignatureFocusMove, run: () => unknown) => Promise<string | null>;
  /** The model of a module of what the page shows; null for one it holds none of. */
  moduleStore: (moduleId: string) => Store | null;
  /** Rejects when the name is empty. */
  makeRestorePoint: (name: string) => Promise<void>;
  /** Restore the project to a restore point; itself a step undo takes back. */
  restoreToRestorePoint: (restorePointId: string) => Promise<void>;
  pinRestorePoint: (restorePointId: string) => Promise<void>;
  unpinRestorePoint: (restorePointId: string) => Promise<void>;
  deleteRestorePoint: (restorePointId: string) => Promise<void>;
  /** The storage behind the host: whether it holds one project, and its name. */
  storage: StorageTraits;
  /** The host's storage, for the project list. */
  persistence: ClientPersistence;
  /** Rejects while the project is open in another tab. */
  deleteProject: (projectId: string) => Promise<void>;
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
  /** Archive a module other than the open one. */
  archiveModule: (id: string) => Promise<void>;
  /** Archived modules of the open project, most recently archived first. */
  archivedModules: ModuleSummary[];
  bringBackModule: (id: string) => Promise<void>;
  /** Rejects when the name is empty, invalid, or taken. */
  renameModule: (id: string, name: string) => Promise<void>;
  /** Rejects when the name is empty or taken. */
  renameProject: (name: string) => Promise<void>;
  /** Rejects when the name is empty or taken. */
  createProject: (name: string) => Promise<ProjectIdentity>;
  /** Import a file's text as a new project; rejects with what is wrong with the file. */
  importNewProject: (text: string, fileName: string) => Promise<ProjectIdentity>;
  /** Import a file's text in place of the open project; rejects with what is wrong with the file, changing nothing. */
  importProjectFile: (text: string, fileName: string) => Promise<void>;
  /** Save an export of the project, or of one of its restore points, as a file. */
  exportProject: (options: ExportOptions, restorePoint?: ListedRestorePoint) => Promise<void>;
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
