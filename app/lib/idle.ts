/**
 * Run once the thread is idle, or after `longestWaitMs` at most: in a page,
 * when nothing waits to be drawn; in a server, once the work under way is
 * done. Returns the way to call it off.
 */
export function whenIdle(run: () => void, longestWaitMs: number): () => void {
  if (typeof requestIdleCallback === "function") {
    const request = requestIdleCallback(run, { timeout: longestWaitMs });
    return () => cancelIdleCallback(request);
  }
  const timer = setTimeout(run, 0);
  return () => clearTimeout(timer);
}
