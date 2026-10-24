import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Where a project file's history lives: one directory per project file
 * under the user's state directory, named after the file's absolute path.
 */
export function stateDirectoryFor(
  projectFile: string,
  environment: Record<string, string | undefined> = process.env,
): string {
  const root = environment.XDG_STATE_HOME?.trim() || join(homedir(), ".local", "state");
  const absolute = resolve(projectFile);
  const key = createHash("sha256").update(absolute).digest("hex").slice(0, 16);
  const directory = join(root, "requireganizer", "projects", key);
  mkdirSync(directory, { recursive: true });
  // Names the project file, for a person looking through the directory.
  writeFileSync(join(directory, "project-file.txt"), `${absolute}\n`);
  return directory;
}

/**
 * The secret this project's server gives its pages. It is kept between runs,
 * so a page left open reconnects after a restart, and only the user can read it.
 */
export function serverToken(stateDirectory: string): string {
  const path = join(stateDirectory, "token");
  if (existsSync(path)) {
    const stored = readFileSync(path, "utf8").trim();
    if (stored.length > 0) return stored;
  }
  const token = randomBytes(32).toString("base64url");
  writeFileSync(path, `${token}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return token;
}

/** The one server serving a project, recorded in its state directory. */
export interface ProjectClaim {
  /** Record where the claiming server can be opened. */
  announce(url: string): void;
  release(): void;
}

function isRunning(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    // A process of another user still runs; only a missing one is gone.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Claim the project for this process, so two servers never write one project
 * file. Throws, naming where the other server runs, while another process
 * holds the claim; a claim left by a process that ended is taken over.
 */
export function claimProject(stateDirectory: string): ProjectClaim {
  const path = join(stateDirectory, "server.json");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let descriptor: number;
    try {
      descriptor = openSync(path, "wx");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let held: { pid?: unknown; url?: unknown } = {};
      try {
        held = JSON.parse(readFileSync(path, "utf8")) as typeof held;
      } catch {
        // An unreadable claim was cut off while being written; it is stale.
      }
      if (typeof held.pid === "number" && isRunning(held.pid)) {
        const where = typeof held.url === "string" ? ` at ${held.url}` : "";
        throw new Error(`Another Requireganizer server is already serving this project${where}.`);
      }
      rmSync(path, { force: true });
      continue;
    }
    writeFileSync(descriptor, JSON.stringify({ pid: process.pid }));
    closeSync(descriptor);
    return {
      announce: (url) => writeFileSync(path, JSON.stringify({ pid: process.pid, url })),
      release: () => rmSync(path, { force: true }),
    };
  }
  throw new Error("Another Requireganizer server is starting for this project.");
}
