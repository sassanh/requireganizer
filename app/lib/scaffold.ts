import { InvalidJsonError, isRecord, parseJson } from "./json";

export interface ScaffoldFileData {
  path: string;
  content: string;
}

const MAX_VIRTUAL_PATH_LENGTH = 255;

export function isSafeVirtualPath(path: string): boolean {
  if (
    path.length === 0 ||
    path.length > MAX_VIRTUAL_PATH_LENGTH ||
    path !== path.trim() ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("\0") ||
    /^[a-z]:/i.test(path)
  ) {
    return false;
  }

  const segments = path.split("/");
  return segments.every(
    (segment) => segment.length > 0 && segment !== "." && segment !== "..",
  );
}

export function assertSafeVirtualPath(value: unknown): string {
  if (typeof value !== "string" || !isSafeVirtualPath(value)) {
    throw new InvalidJsonError(
      "Scaffold file paths must be safe, relative POSIX paths.",
    );
  }
  return value;
}

export function parseScaffoldFiles(value: unknown): ScaffoldFileData[] {
  if (!Array.isArray(value)) {
    throw new InvalidJsonError("Scaffold files must be a JSON array.");
  }

  const seenPaths = new Set<string>();
  return value.map((candidate, index) => {
    if (!isRecord(candidate)) {
      throw new InvalidJsonError(`Scaffold file ${index + 1} must be an object.`);
    }

    const path = assertSafeVirtualPath(candidate.path);
    if (seenPaths.has(path)) {
      throw new InvalidJsonError(`Scaffold contains duplicate path \"${path}\".`);
    }
    seenPaths.add(path);

    if (typeof candidate.content !== "string") {
      throw new InvalidJsonError(
        `Scaffold file \"${path}\" must contain text content.`,
      );
    }

    return { path, content: candidate.content };
  });
}

export function parseScaffoldFilesJson(source: string): ScaffoldFileData[] {
  return parseScaffoldFiles(parseJson(source, "Scaffold response"));
}
