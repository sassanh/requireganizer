/**
 * Where the computer the project server runs on keeps each coding agent's
 * session id, by the hash the project keeps of it, so the spec owner can
 * find and resume a session after it closed, while the project itself
 * holds only the hash and never a session id.
 */
export interface SessionsSource {
  /** The session id whose hash this is; null when this computer never saw it. */
  idOf(hash: string): string | null;
  /** Keep the session id a coding tool told, by its hash. */
  remember(hash: string, id: string): void;
}

/** Sessions kept only while the page runs, as a page with no server keeps them. */
export function memorySessions(): SessionsSource {
  const ids = new Map<string, string>();
  return {
    idOf: (hash) => ids.get(hash) ?? null,
    remember: (hash, id) => {
      ids.set(hash, id);
    },
  };
}
