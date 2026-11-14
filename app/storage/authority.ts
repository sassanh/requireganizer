/**
 * The right to be a project's one writer. Holding it, a session is the
 * project's authority; another may ask for it, and then this one finishes
 * its writes and gives it up.
 */
export interface AuthorityClaim {
  /**
   * Called once when the claim ends without `release`: with `asked` when
   * another session asked for the project, which waits for the returned
   * promise before taking it, and without when it was taken outright.
   */
  onEnd(listener: (asked: boolean) => Promise<void> | void): void;
  release(): void;
}

/** Who may write each project, for a storage that several sessions share. */
export interface ProjectAuthority {
  /**
   * Hold the project. Null while another session holds it, unless
   * `takeOver`, which asks that session to give it up and takes it.
   */
  claim(projectId: string, options: { takeOver: boolean }): Promise<AuthorityClaim | null>;
}

/** How long a session asked to give a project up has before it is taken anyway, such as one in a frozen tab. */
const TAKE_OVER_WAIT_MS = 3_000;

const CHANNEL_NAME = "requireganizer-authority";

interface TakeOverMessage {
  type: "take-over";
  projectId: string;
}

function lockName(projectId: string): string {
  return `requireganizer:project:${projectId}`;
}

/**
 * The browser's authority: one Web Lock per project, so of all the tabs
 * that open a project only one writes it. A tab that takes a project over
 * asks the holder over a broadcast channel to finish its writes and let go,
 * and takes the lock outright when the holder does not answer in time.
 * Without Web Locks, as outside a secure context, every claim succeeds.
 */
export const webProjectAuthority: ProjectAuthority = {
  claim: (projectId, { takeOver }) => {
    if (typeof navigator === "undefined" || navigator.locks == null) {
      return Promise.resolve({ onEnd: () => {}, release: () => {} });
    }
    const locks = navigator.locks;
    const name = lockName(projectId);
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL_NAME);
    return new Promise<AuthorityClaim | null>((resolve) => {
      let releaseLock: (() => void) | null = null;
      let endListener: ((asked: boolean) => Promise<void> | void) | null = null;
      let ended = false;
      const end = (asked: boolean): Promise<void> => {
        if (ended) return Promise.resolve();
        ended = true;
        channel?.close();
        return Promise.resolve(endListener?.(asked)).catch((error: unknown) => {
          console.error("Could not finish the project's writes before giving it up.", error);
        });
      };
      const granted = (lock: Lock | null): Promise<void> | undefined => {
        if (lock == null) {
          channel?.close();
          resolve(null);
          return undefined;
        }
        const held = new Promise<void>((letGo) => {
          releaseLock = letGo;
        });
        if (channel != null) {
          channel.onmessage = (event: MessageEvent<TakeOverMessage>) => {
            if (event.data?.type !== "take-over" || event.data.projectId !== projectId) return;
            void end(true).then(() => releaseLock?.());
          };
        }
        resolve({
          onEnd: (listener) => {
            endListener = listener;
          },
          release: () => {
            ended = true;
            channel?.close();
            releaseLock?.();
          },
        });
        return held;
      };
      const wait = new AbortController();
      const failed = (error: unknown) => {
        if (releaseLock != null) {
          // Taken outright by another tab.
          if ((error as { name?: unknown }).name === "AbortError") void end(false);
          else console.error("Stopped holding the project.", error);
          return;
        }
        // The wait for the holder ended; the lock is taken outright instead.
        if (wait.signal.aborted && (error as { name?: unknown }).name === "AbortError") return;
        // Web Locks failed: the project opens as it would without them.
        console.error("Could not hold the project.", error);
        channel?.close();
        resolve({ onEnd: () => {}, release: () => {} });
      };
      if (!takeOver) {
        locks.request(name, { ifAvailable: true }, granted).catch(failed);
        return;
      }
      const timer = setTimeout(() => {
        wait.abort();
        locks.request(name, { steal: true }, granted).catch(failed);
      }, TAKE_OVER_WAIT_MS);
      locks
        .request(name, { signal: wait.signal }, (lock) => {
          clearTimeout(timer);
          return granted(lock);
        })
        .catch(failed);
      const asking = new BroadcastChannel(CHANNEL_NAME);
      asking.postMessage({ type: "take-over", projectId } satisfies TakeOverMessage);
      asking.close();
    });
  },
};
