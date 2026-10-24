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

/**
 * A place in the open project, given as the store gives it: a query of the
 * project page and a fragment, such as `?step=user-stories#US-1`.
 */
export function projectPlaceHref(projectId: string, place: string): string {
  const url = new URL(place, "http://place.invalid/project");
  const query = new URLSearchParams({ id: projectId });
  for (const [key, value] of url.searchParams) {
    if (key !== "id") query.append(key, value);
  }
  return `/project?${query.toString()}${url.hash}`;
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
