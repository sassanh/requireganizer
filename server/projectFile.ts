import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const PROJECT_FILE_NAME = "requireganizer.json";

/**
 * The project file a server run serves: the one named, or else the nearest
 * `requireganizer.json` in the working directory or a folder above it, or
 * else a new one in the working directory.
 */
export function resolveProjectFile(named: string | null, workingDirectory: string): string {
  if (named != null) return resolve(workingDirectory, named);
  let directory = resolve(workingDirectory);
  for (;;) {
    const candidate = join(directory, PROJECT_FILE_NAME);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(directory);
    if (parent === directory) return join(resolve(workingDirectory), PROJECT_FILE_NAME);
    directory = parent;
  }
}
