"use client";

import { reaction } from "mobx";
import { useEffect, useState } from "react";

import type { ProviderCallRecord } from "lib/types";
import { usePersistence } from "projectContext";
import type { Store } from "store";

function copyCalls(calls: readonly ProviderCallRecord[]): ProviderCallRecord[] {
  return calls.map((call) => ({
    ...call,
    usage: call.usage == null ? undefined : { ...call.usage },
  }));
}

export function useProviderCallPersistence(
  projectId: string | null,
  moduleId: string | null,
  store: Store,
): string | null {
  const persistence = usePersistence();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (projectId == null || moduleId == null) return;

    let disposed = false;
    let stopReaction: (() => void) | undefined;
    let saveQueue = Promise.resolve();

    const initialize = async () => {
      try {
        const stored = await persistence.providerCalls.load(
          projectId,
          moduleId,
        );
        if (disposed) return;

        // Saving starts from the merged list, so the stored history is never
        // replaced by the calls recorded before it was read.
        await store.hydrateProviderCalls(stored);
        if (disposed) return;

        stopReaction = reaction(
          () => copyCalls(store.providerCalls),
          (calls) => {
            saveQueue = saveQueue
              .then(() =>
                persistence.providerCalls.replace(projectId, moduleId, calls),
              )
              .then(() => {
                if (!disposed) setError(null);
              })
              .catch((storageError: unknown) => {
                console.error("Could not persist AI provider activity.", storageError);
                if (!disposed) {
                  setError(
                    `AI provider activity could not be saved in ${persistence.traits.name}.`,
                  );
                }
              });
          },
          { fireImmediately: true },
        );
        setError(null);
      } catch (storageError) {
        console.error("Could not load AI provider activity.", storageError);
        if (!disposed) {
          setError(`AI provider activity could not be loaded from ${persistence.traits.name}.`);
        }
      }
    };

    void initialize();
    return () => {
      disposed = true;
      stopReaction?.();
    };
  }, [persistence, projectId, moduleId, store]);

  return error;
}
