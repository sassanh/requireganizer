import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

/**
 * The path a project file is known by: its real path, so every path that
 * reaches the same file, through a symbolic link or not, names one project.
 * A file not created yet is named through its folder's real path.
 */
function canonicalPath(projectFile: string): string {
  const absolute = resolve(projectFile);
  for (const candidate of [absolute, dirname(absolute)]) {
    try {
      const real = realpathSync(candidate);
      return candidate === absolute ? real : join(real, basename(absolute));
    } catch {
      // Not there yet; try its folder.
    }
  }
  return absolute;
}

/**
 * Where a project file's history lives: one directory per project file
 * under the user's state directory, named after the file's real path.
 */
export function stateDirectoryFor(
  projectFile: string,
  environment: Record<string, string | undefined> = process.env,
): string {
  const root = environment.XDG_STATE_HOME?.trim() || join(homedir(), ".local", "state");
  const absolute = canonicalPath(projectFile);
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
  const stored = storedServerToken(stateDirectory);
  if (stored != null) return stored;
  const path = join(stateDirectory, "token");
  const token = randomBytes(32).toString("base64url");
  // Moved into place whole, so a process reading it never sees it half written.
  const draft = `${path}.${process.pid}`;
  writeFileSync(draft, `${token}\n`, { mode: 0o600 });
  chmodSync(draft, 0o600);
  renameSync(draft, path);
  return token;
}

/** The token of the server that serves the project, for a process that connects to it; null before one was made. */
export function storedServerToken(stateDirectory: string): string | null {
  const path = join(stateDirectory, "token");
  if (!existsSync(path)) return null;
  const stored = readFileSync(path, "utf8").trim();
  return stored.length > 0 ? stored : null;
}

/**
 * The port the project was last served on. A server that takes over from
 * another listens there first, so pages left open reconnect to it.
 */
export function rememberedPort(stateDirectory: string): number | null {
  try {
    const port = Number(readFileSync(join(stateDirectory, "port"), "utf8").trim());
    return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
  } catch {
    return null;
  }
}

export function rememberPort(stateDirectory: string, port: number): void {
  writeFileSync(join(stateDirectory, "port"), `${port}\n`);
}

/** The one server serving a project, recorded in its state directory. */
export interface ProjectClaim {
  /** Record where the claiming server can be opened. */
  announce(url: string): void;
  release(): void;
}

/**
 * The outcome of claiming a project: the claim, or where the process that
 * holds it serves the project; `url` is null while that server is starting.
 */
export type ClaimResult = { claim: ProjectClaim } | { heldBy: { url: string | null } };

function isRunning(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    // A process of another user still runs; only a missing one is gone.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

type HeldClaim = { pid: number; url: string | null };

/** The claim recorded at `path`; null when there is none or it is not one. */
function heldClaim(path: string): HeldClaim | null {
  let held: { pid?: unknown; url?: unknown };
  try {
    held = JSON.parse(readFileSync(path, "utf8")) as typeof held;
  } catch {
    return null;
  }
  if (typeof held.pid !== "number") return null;
  return { pid: held.pid, url: typeof held.url === "string" ? held.url : null };
}

/** A takeover lock older than this was left by a process that ended while holding it. */
const TAKEOVER_LOCK_STALE_MS = 5_000;

/**
 * Run `action` while this process alone may remove the claim at `path`.
 * False, without running it, while another process holds that right.
 */
function whileTakingOver(path: string, action: () => void): boolean {
  const lock = `${path}.takeover`;
  try {
    writeFileSync(lock, String(process.pid), { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    try {
      if (Date.now() - statSync(lock).mtimeMs > TAKEOVER_LOCK_STALE_MS) rmSync(lock, { force: true });
    } catch {
      // Released meanwhile.
    }
    return false;
  }
  try {
    action();
  } finally {
    rmSync(lock, { force: true });
  }
  return true;
}

function sameClaim(left: HeldClaim | null, right: HeldClaim | null): boolean {
  return left?.pid === right?.pid && left?.url === right?.url;
}

/**
 * Remove the claim at `path` while it is still `held` (null for one that is
 * not a claim), never one made since. Several processes may decide to remove
 * one claim at once: only one does. False when another process is removing it.
 */
function removeClaim(path: string, held: HeldClaim | null): boolean {
  return whileTakingOver(path, () => {
    if (sameClaim(heldClaim(path), held)) rmSync(path, { force: true });
  });
}

/**
 * Give up the claim of a server that does not answer at its URL, such as one
 * whose process ended and whose process id now names another process. The
 * claim `answers` probed is removed only while it is still the one recorded.
 */
export async function releaseUnreachableClaim(
  stateDirectory: string,
  answers: (url: string) => Promise<boolean>,
): Promise<void> {
  const path = join(stateDirectory, "server.json");
  const held = heldClaim(path);
  if (held?.url == null || (await answers(held.url))) return;
  removeClaim(path, held);
}

/**
 * Claim the project for this process, so two servers never write one project
 * file. While another process holds the claim, says where it serves the
 * project; a claim left by a process that ended is taken over.
 */
export function claimProject(stateDirectory: string): ClaimResult {
  const path = join(stateDirectory, "server.json");
  // Written beside the claim and then moved into place, so a claim is never
  // seen half written.
  const draft = `${path}.${process.pid}`;
  const record = (url: string | null) => writeFileSync(draft, JSON.stringify({ pid: process.pid, url }));
  for (let attempt = 0; attempt < 2; attempt += 1) {
    record(null);
    try {
      linkSync(draft, path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const held = heldClaim(path);
      if (held != null && isRunning(held.pid)) return { heldBy: { url: held.url } };
      if (!removeClaim(path, held)) return { heldBy: { url: null } };
      continue;
    } finally {
      rmSync(draft, { force: true });
    }
    return {
      claim: {
        announce: (url) => {
          record(url);
          renameSync(draft, path);
        },
        release: () => {
          // Never remove a claim another process has made since.
          if (heldClaim(path)?.pid === process.pid) rmSync(path, { force: true });
        },
      },
    };
  }
  // Another process took the stale claim over between the two attempts.
  return { heldBy: { url: null } };
}
