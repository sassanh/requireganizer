/** A project's identity: who it is and what the spec owner calls it. It is not part of the project's state. */
export interface ProjectIdentity {
  id: string;
  name: string;
}

/** A stored project as a project list shows it. */
export interface ProjectMeta extends ProjectIdentity {
  updatedAt: string;
}

export class ProjectStorageError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ProjectStorageError";
  }
}

export const PROJECT_SAVE_ERROR_MESSAGE = "Could not save the project.";
export const PROJECT_DELETE_ERROR_MESSAGE = "Could not delete the project.";

/** Whether a project already has this name: names compare ignoring case and accents. */
export function hasProjectName(projects: readonly ProjectIdentity[], name: string): boolean {
  return projects.some(
    (project) => project.name.localeCompare(name, undefined, { sensitivity: "base" }) === 0,
  );
}
