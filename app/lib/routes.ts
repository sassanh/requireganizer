/**
 * The addresses of the project pages. Projects are named in the query, not
 * the path, so one static export of the interface serves every project.
 */
export function projectHref(projectId: string): string {
  return `/project?${new URLSearchParams({ id: projectId }).toString()}`;
}

/** The project's files, opened at `path` when one is given. */
export function projectCodeHref(projectId: string, path: string | null = null): string {
  const query = new URLSearchParams({ id: projectId });
  if (path != null) query.set("path", path);
  return `/project/code?${query.toString()}`;
}

/** The page at `pathname` showing `step`, keeping the project, module and all else `search` names but the unit or thread message it focuses. */
export function stepHref(pathname: string, search: string, step: string): string {
  const query = new URLSearchParams(search);
  query.set("step", step);
  query.delete("unit");
  query.delete("thread");
  query.delete("message");
  return `${pathname}?${query.toString()}`;
}

/**
 * The page at `pathname` showing `step` with `unit` focused, or with
 * `message`, a message of a thread on it, in `module` when one is given,
 * keeping the project, module and all else `search` names.
 */
export function unitHref(
  pathname: string,
  search: string,
  place: { module?: string; step: string; unit: string; message?: { threadId: string; index: number } | null },
): string {
  const query = new URLSearchParams(search);
  if (place.module != null) query.set("module", place.module);
  query.set("step", place.step);
  query.set("unit", place.unit);
  query.delete("thread");
  query.delete("message");
  if (place.message != null) {
    query.set("thread", place.message.threadId);
    query.set("message", String(place.message.index));
  }
  return `${pathname}?${query.toString()}`;
}

/**
 * Where a link from before projects moved to the query leads now:
 * `/project/<id>` and `/project/<id>/code/<path>`. Null for anything else.
 */
export function currentHrefOf(pathname: string, search: string, hash: string): string | null {
  const match = /^\/project\/([^/]+)(?:\/code(?:\/(.*?))?)?\/?$/.exec(pathname);
  if (match == null) return null;
  const projectId = decodeURIComponent(match[1]!);
  if (pathname.includes("/code")) {
    const path = match[2] == null || match[2] === "" ? null : match[2].split("/").map(decodeURIComponent).join("/");
    return projectCodeHref(projectId, path);
  }
  const query = new URLSearchParams(search);
  query.delete("id");
  const rest = query.toString();
  return `${projectHref(projectId)}${rest === "" ? "" : `&${rest}`}${hash}`;
}
