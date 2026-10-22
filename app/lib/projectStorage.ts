import { TIMELINE_VERSION } from "store/timeline/serialize";

import { isRecord, parseJson } from "./json";
import { LEGACY_MODULE_ID, parseProjectPayload, pickActiveModule } from "./moduleSchema";
import { deleteProjectSnapshots } from "./revisionStorage";
import { parseScaffoldFiles, ScaffoldFileData } from "./scaffold";

const PROJECTS_INDEX_KEY = "requireganizer:projects";

export interface ProjectKeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ProjectMeta {
  id: string;
  name: string;
  description: string;
  updatedAt: string;
}

export interface StoredProjectView {
  name: string;
  scaffoldFiles: ScaffoldFileData[];
}

export class ProjectStorageError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ProjectStorageError";
  }
}

export const PROJECT_INDEX_SAVE_ERROR_MESSAGE =
  "Could not save the projects index.";
export const PROJECT_SAVE_ERROR_MESSAGE = "Could not save the project.";
export const PROJECT_BUNDLE_SERIALIZE_ERROR_MESSAGE =
  "Could not serialize the imported project.";
export const PROJECT_BUNDLE_SAVE_ERROR_MESSAGE =
  "Could not save the imported project.";
export const PROJECT_DELETE_ERROR_MESSAGE = "Could not delete the project.";

function getBrowserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function requireBrowserStorage(): Storage {
  const storage = getBrowserStorage();
  if (storage == null) {
    throw new ProjectStorageError("Browser storage is unavailable.");
  }
  return storage;
}

function isProjectMeta(value: unknown): value is ProjectMeta {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.name === "string" &&
    value.name.length > 0 &&
    typeof value.description === "string" &&
    typeof value.updatedAt === "string" &&
    !Number.isNaN(Date.parse(value.updatedAt))
  );
}

export function parseProjectsIndex(source: string | null): ProjectMeta[] {
  if (source == null) return [];

  try {
    const value = parseJson(source, "Projects index");
    if (!Array.isArray(value)) return [];

    const seenIds = new Set<string>();
    return value.filter((candidate): candidate is ProjectMeta => {
      if (!isProjectMeta(candidate) || seenIds.has(candidate.id)) return false;
      seenIds.add(candidate.id);
      return true;
    });
  } catch {
    return [];
  }
}

/** Removes a project's index entry while keeping every other entry in order. */
export function removeProjectFromIndex(
  projects: readonly ProjectMeta[],
  id: string,
): ProjectMeta[] {
  return projects.filter((project) => project.id !== id);
}

export function getProjectsIndex(): ProjectMeta[] {
  const storage = getBrowserStorage();
  if (storage == null) return [];

  try {
    return parseProjectsIndex(storage.getItem(PROJECTS_INDEX_KEY));
  } catch {
    return [];
  }
}

export function saveProjectsIndex(projects: ProjectMeta[]): void {
  try {
    requireBrowserStorage().setItem(PROJECTS_INDEX_KEY, JSON.stringify(projects));
  } catch (error) {
    if (error instanceof ProjectStorageError) throw error;
    throw new ProjectStorageError(PROJECT_INDEX_SAVE_ERROR_MESSAGE, error);
  }
}

export function getProjectStorageKey(id: string): string {
  return `requireganizer:project:${id}`;
}

export function getTimelineStorageKey(id: string, moduleId: string): string {
  return `requireganizer:timeline:${id}::${moduleId}`;
}

/** Every module timeline of a project starts with this key prefix. */
export function getTimelineStorageKeyPrefix(id: string): string {
  return `requireganizer:timeline:${id}::`;
}

/** The pre-module key; only the legacy module ever still reads it. */
function getLegacyTimelineStorageKey(id: string): string {
  return `requireganizer:timeline:${id}`;
}

/** The one reader of stored timeline bytes. */
export function parseTimelineData(
  source: string | null,
): Record<string, unknown> | null {
  if (source == null) return null;

  try {
    const value = parseJson(source, "Stored timeline");
    if (!isRecord(value) || value.version !== TIMELINE_VERSION) return null;
    return value;
  } catch {
    return null;
  }
}

export function loadTimelineData(
  id: string,
  moduleId: string,
): Record<string, unknown> | null {
  const storage = getBrowserStorage();
  if (storage == null) return null;

  try {
    const source =
      storage.getItem(getTimelineStorageKey(id, moduleId)) ??
      (moduleId === LEGACY_MODULE_ID
        ? storage.getItem(getLegacyTimelineStorageKey(id))
        : null);
    return parseTimelineData(source);
  } catch {
    return null;
  }
}

/**
 * Returns false when the write failed (e.g. quota exceeded) so the timeline
 * controller can degrade by trimming history instead of surfacing an error.
 */
export function saveTimelineData(id: string, moduleId: string, data: unknown): boolean {
  try {
    requireBrowserStorage().setItem(
      getTimelineStorageKey(id, moduleId),
      JSON.stringify(data),
    );
    return true;
  } catch {
    return false;
  }
}

/** The one reader of stored project bytes. */
export function parseStoredProjectData(
  source: string | null,
): Record<string, unknown> | null {
  if (source == null) return null;

  try {
    const value = parseJson(source, "Stored project");
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

export function loadProjectData(id: string): Record<string, unknown> | null {
  const storage = getBrowserStorage();
  if (storage == null) return null;

  try {
    return parseStoredProjectData(storage.getItem(getProjectStorageKey(id)));
  } catch {
    return null;
  }
}

export function saveProjectData(id: string, data: unknown): void {
  try {
    requireBrowserStorage().setItem(
      getProjectStorageKey(id),
      JSON.stringify(data),
    );
  } catch (error) {
    if (error instanceof ProjectStorageError) throw error;
    throw new ProjectStorageError(PROJECT_SAVE_ERROR_MESSAGE, error);
  }
}

export function saveProjectBundle(
  id: string,
  data: unknown,
  projects: ProjectMeta[],
): void {
  saveProjectBundleToStorage(requireBrowserStorage(), id, data, projects);
}

export interface ProjectBundleSources {
  projectSource: string;
  indexSource: string;
}

/**
 * The pure first half of a bundle write: serialize both records before either
 * is stored, so a serialization failure leaves storage untouched.
 */
export function serializeProjectBundle(
  data: unknown,
  projects: ProjectMeta[],
): ProjectBundleSources {
  let projectSource: string | undefined;
  let indexSource: string | undefined;
  try {
    projectSource = JSON.stringify(data);
    indexSource = JSON.stringify(projects);
  } catch (error) {
    throw new ProjectStorageError(
      PROJECT_BUNDLE_SERIALIZE_ERROR_MESSAGE,
      error,
    );
  }
  if (projectSource === undefined || indexSource === undefined) {
    throw new ProjectStorageError(PROJECT_BUNDLE_SERIALIZE_ERROR_MESSAGE);
  }
  return { projectSource, indexSource };
}

export function saveProjectBundleToStorage(
  storage: ProjectKeyValueStorage,
  id: string,
  data: unknown,
  projects: ProjectMeta[],
): void {
  const { projectSource, indexSource } = serializeProjectBundle(data, projects);
  const projectKey = getProjectStorageKey(id);

  let previousProjectSource: string | null = null;
  let previousIndexSource: string | null = null;
  let capturedState = false;
  try {
    previousProjectSource = storage.getItem(projectKey);
    previousIndexSource = storage.getItem(PROJECTS_INDEX_KEY);
    capturedState = true;
    storage.setItem(projectKey, projectSource);
    storage.setItem(PROJECTS_INDEX_KEY, indexSource);
  } catch (error) {
    try {
      if (capturedState) {
        if (previousProjectSource == null) storage.removeItem(projectKey);
        else storage.setItem(projectKey, previousProjectSource);

        if (previousIndexSource == null) storage.removeItem(PROJECTS_INDEX_KEY);
        else storage.setItem(PROJECTS_INDEX_KEY, previousIndexSource);
      }
    } catch (rollbackError) {
      console.error(
        "Could not roll back a failed imported-project save.",
        rollbackError,
      );
    }
    throw new ProjectStorageError(PROJECT_BUNDLE_SAVE_ERROR_MESSAGE, error);
  }
}

export function deleteProjectData(id: string): void {
  const storage = requireBrowserStorage();
  const projectKey = getProjectStorageKey(id);
  let projectSource: string | null = null;
  let indexSource: string | null = null;
  let capturedState = false;

  try {
    projectSource = storage.getItem(projectKey);
    indexSource = storage.getItem(PROJECTS_INDEX_KEY);
    capturedState = true;
    const projects = removeProjectFromIndex(
      parseProjectsIndex(indexSource),
      id,
    );

    storage.removeItem(projectKey);
    storage.removeItem(getLegacyTimelineStorageKey(id));
    // Every module's timeline is keyed under the project prefix; remove them all.
    const timelinePrefix = getTimelineStorageKeyPrefix(id);
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index);
      if (key != null && key.startsWith(timelinePrefix)) {
        storage.removeItem(key);
      }
    }
    storage.setItem(PROJECTS_INDEX_KEY, JSON.stringify(projects));
    void deleteProjectSnapshots(id).catch((error) => {
      console.error("Could not delete project revision snapshots.", error);
    });
  } catch (error) {
    try {
      if (capturedState) {
        if (projectSource == null) storage.removeItem(projectKey);
        else storage.setItem(projectKey, projectSource);

        if (indexSource == null) storage.removeItem(PROJECTS_INDEX_KEY);
        else storage.setItem(PROJECTS_INDEX_KEY, indexSource);
      }
    } catch (rollbackError) {
      console.error("Could not roll back a failed project deletion.", rollbackError);
    }
    throw new ProjectStorageError(PROJECT_DELETE_ERROR_MESSAGE, error);
  }
}

export function readStoredProjectView(
  data: Record<string, unknown> | null,
): StoredProjectView | null {
  if (data == null) return null;

  let snapshot: Record<string, unknown>;
  try {
    snapshot = pickActiveModule(parseProjectPayload(data)).snapshot;
  } catch {
    // Stored bytes that are not a project at all expose nothing.
    return null;
  }

  const productOverview = isRecord(snapshot.productOverview)
    ? snapshot.productOverview
    : null;
  const name =
    typeof productOverview?.name === "string" ? productOverview.name : "";

  try {
    return {
      name,
      scaffoldFiles: parseScaffoldFiles(snapshot.scaffoldFiles ?? []),
    };
  } catch {
    return { name, scaffoldFiles: [] };
  }
}
