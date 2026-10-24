import { createReadStream, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize, sep } from "node:path";

import { requestTarget } from "./requestTarget";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** The file a request path names in `root`: itself, its `.html` page, or its folder's index. */
function fileFor(root: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const relative = normalize(decoded).replace(/^([/\\])+/, "");
  const base = join(root, relative);
  if (base === root) return isFile(join(root, "index.html")) ? join(root, "index.html") : null;
  if (!base.startsWith(root + sep)) return null;
  for (const candidate of [base, `${base}.html`, join(base, "index.html")]) {
    if (isFile(candidate)) return candidate;
  }
  return null;
}

/**
 * Serve a static export of the interface from `root`. Hashed build assets are
 * cached for good; pages are revalidated, so a new build shows on reload.
 */
export function serveStaticFiles(
  root: string,
  request: IncomingMessage,
  response: ServerResponse,
): void {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { allow: "GET, HEAD" }).end();
    return;
  }
  const pathname = requestTarget(request)?.pathname ?? null;
  const found = pathname == null ? null : fileFor(root, pathname);
  const file = found ?? fileFor(root, "/404.html");
  if (file == null) {
    response.writeHead(404, { "content-type": CONTENT_TYPES[".txt"]! }).end("Not found.");
    return;
  }
  const headers: Record<string, string> = {
    "content-type": CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
    // Only a hashed asset that exists is the same forever; a missing one may appear with the next build.
    "cache-control": found != null && pathname?.startsWith("/_next/static/")
      ? "public, max-age=31536000, immutable"
      : "no-cache",
    "x-content-type-options": "nosniff",
  };
  response.writeHead(found == null ? 404 : 200, headers);
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  // A rebuild can remove the file between finding and reading it.
  createReadStream(file).on("error", () => response.destroy()).pipe(response);
}
