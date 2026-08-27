import { createContext, useContext } from "react";

import { Store, useStore } from "store/store";

export const presentationStoreContext = createContext<Store | null>(null);

/** Delayed replica used for display. Falls back to the real store when
 * no replica is attached (tests, project picker). */
export function usePresentationStore(): Store | null {
  return useContext(presentationStoreContext);
}

export function useShownStore(): Store {
  const shown = usePresentationStore();
  const real = useStore();
  return shown ?? real;
}
