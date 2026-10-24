import type { IncomingMessage } from "node:http";

/**
 * The path and query a request names, or null when its target is not a path
 * on this server. Parsing the target against a base would read `//x` as
 * another host; every target is read as a path instead.
 */
export function requestTarget(request: IncomingMessage): URL | null {
  const target = request.url ?? "/";
  if (!target.startsWith("/")) return null;
  try {
    return new URL(`http://server.invalid${target}`);
  } catch {
    return null;
  }
}

/** The loopback addresses a page of the server on `port` can be loaded from. */
export function ownHosts(port: number): Set<string> {
  return new Set([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]);
}
