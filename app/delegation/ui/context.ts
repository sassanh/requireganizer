"use client";

import { createContext, useContext } from "react";

import type { Store } from "store";

import type { DelegationClient } from "../client";
import type { AssignTarget, DelegationView } from "../host";
import type { AttentionOffer, PointedPlace } from "../pointers";

/** Delegation as the page reads it: the host's view, the offers agents made, and the page's own readings of places. */
export interface DelegationPageValue {
  client: DelegationClient;
  view: DelegationView;
  /** What agents pointed the spec owner to, oldest first. */
  offers: readonly AttentionOffer[];
  dismissOffer: (offerId: string) => Promise<void>;
  /** A pointed unit as the spec owner reads where it is, such as "REQ-04, Requirements". */
  placeLabel: (place: PointedPlace) => string;
  /** A stage's label. */
  stageLabel: (stage: string) => string;
  /** The module the page shows. */
  activeModuleId: string;
  /** Every module of the open project, each with its name while the project has modules turned on. */
  modules: readonly { id: string; name: string | null }[];
  /** The model of a module the page holds; null for one it holds none of. */
  moduleStore: (moduleId: string) => Store | null;
  /** Run `run`, assigning the thread of each message of the spec owner's it sends to `to`, or to none. */
  withAssignment: <Value>(to: AssignTarget | null, run: () => Value) => Value;
}

export const delegationContext = createContext<DelegationPageValue | null>(null);

export function useDelegation(): DelegationPageValue {
  const value = useContext(delegationContext);
  if (value == null) throw new Error("useDelegation must be used inside the page's providers.");
  return value;
}
