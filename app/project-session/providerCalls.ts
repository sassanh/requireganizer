import { reaction } from "mobx";

import type { ProviderCallRecord } from "lib/types";
import type { PersistenceAdapter } from "persistence";
import type { Store } from "store";

function copyCalls(calls: readonly ProviderCallRecord[]): ProviderCallRecord[] {
  return calls.map((call) => ({
    ...call,
    usage: call.usage == null ? undefined : { ...call.usage },
  }));
}

export interface ProviderCallSaving {
  /** Issue the pending save now, synchronously. */
  flush(): void;
  /** Stop saving changes made from now on; saves already pending still go out. */
  stop(): void;
}

/**
 * Keep a module's AI provider calls in storage while its store is shown:
 * the stored calls are merged into the store, then every change is saved.
 * `report` receives a message for each failure and null after a success.
 */
export function persistProviderCalls(
  persistence: PersistenceAdapter,
  projectId: string,
  moduleId: string,
  store: Store,
  report: (message: string | null) => void,
): ProviderCallSaving {
  let stopped = false;
  let stopReaction: (() => void) | undefined;
  let saveQueue = Promise.resolve();
  /** The newest calls not yet handed to storage; saves run in order, and only the newest matters. */
  let unsaved: ProviderCallRecord[] | null = null;

  const save = (calls: ProviderCallRecord[]): Promise<void> =>
    persistence.providerCalls.replace(projectId, moduleId, calls).then(
      () => {
        if (!stopped) report(null);
      },
      (error: unknown) => {
        console.error("Could not persist AI provider activity.", error);
        if (!stopped) {
          report(`AI provider activity could not be saved in ${persistence.traits.name}.`);
        }
      },
    );
  const saveUnsaved = (): Promise<void> => {
    const calls = unsaved;
    unsaved = null;
    return calls == null ? Promise.resolve() : save(calls);
  };

  const start = async () => {
    try {
      const stored = await persistence.providerCalls.load(projectId, moduleId);
      if (stopped) return;
      // Saving starts from the merged list, so the stored history is never
      // replaced by the calls recorded before it was read.
      store.hydrateProviderCalls(stored);
      stopReaction = reaction(
        () => copyCalls(store.providerCalls),
        (calls) => {
          unsaved = calls;
          saveQueue = saveQueue.then(saveUnsaved);
        },
        { fireImmediately: true },
      );
    } catch (error) {
      console.error("Could not load AI provider activity.", error);
      if (!stopped) {
        report(`AI provider activity could not be loaded from ${persistence.traits.name}.`);
      }
    }
  };

  void start();
  return {
    flush: () => void saveUnsaved(),
    stop: () => {
      stopped = true;
      stopReaction?.();
    },
  };
}
