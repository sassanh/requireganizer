import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const PROJECT_FILE_NAME = "requireganizer.json";

/** A named project file the server can keep, or why it cannot. */
function namedProjectFile(named: string, workingDirectory: string): string {
  const path = resolve(workingDirectory, named);
  if (statSync(path, { throwIfNoEntry: false })?.isDirectory() === true) {
    throw new Error(`${path} is a folder. Name the project file in it, such as ${join(path, PROJECT_FILE_NAME)}.`);
  }
  if (statSync(dirname(path), { throwIfNoEntry: false })?.isDirectory() !== true) {
    throw new Error(`The folder ${dirname(path)} does not exist. Create it, or name a project file in an existing folder.`);
  }
  return path;
}

/**
 * The project file a server run serves: the one named, or else the nearest
 * `requireganizer.json` in the working directory or a folder above it, or
 * else a new one in the working directory. Throws when the named one could
 * never be saved.
 */
export function resolveProjectFile(named: string | null, workingDirectory: string): string {
  if (named != null) return namedProjectFile(named, workingDirectory);
  let directory = resolve(workingDirectory);
  for (;;) {
    const candidate = join(directory, PROJECT_FILE_NAME);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(directory);
    if (parent === directory) return join(resolve(workingDirectory), PROJECT_FILE_NAME);
    directory = parent;
  }
}
