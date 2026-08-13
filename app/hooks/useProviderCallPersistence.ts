"use client";

import { reaction } from "mobx";
import { useEffect, useState } from "react";

import {
  loadProviderCalls,
  mergeProviderCalls,
  replaceProviderCalls,
} from "lib/providerCallStorage";
import type { ProviderCallRecord } from "lib/types";
import type { Store } from "store";

const MAX_PROVIDER_CALL_HISTORY = 100;

function copyCalls(calls: readonly ProviderCallRecord[]): ProviderCallRecord[] {
  return calls.map((call) => ({
    ...call,
    usage: call.usage == null ? undefined : { ...call.usage },
  }));
}

export function useProviderCallPersistence(
  projectId: string | null,
  store: Store,
): string | null {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (projectId == null) return;

    let disposed = false;
    let stopReaction: (() => void) | undefined;
    let saveQueue = Promise.resolve();

    const initialize = async () => {
      try {
        const stored = await loadProviderCalls(projectId);
        if (disposed) return;

        store.hydrateProviderCalls(
          mergeProviderCalls(
            stored,
            copyCalls(store.providerCalls),
            MAX_PROVIDER_CALL_HISTORY,
          ),
        );

        stopReaction = reaction(
          () => copyCalls(store.providerCalls),
          (calls) => {
            saveQueue = saveQueue
              .then(() => replaceProviderCalls(projectId, calls))
              .then(() => {
                if (!disposed) setError(null);
              })
              .catch((storageError: unknown) => {
                console.error("Could not persist AI provider activity.", storageError);
                if (!disposed) {
                  setError(
                    "AI provider activity could not be saved in browser storage.",
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
          setError("AI provider activity could not be loaded from browser storage.");
        }
      }
    };

    void initialize();
    return () => {
      disposed = true;
      stopReaction?.();
    };
  }, [projectId, store]);

  return error;
}
