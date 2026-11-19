"use client";

import { createContext, useContext } from "react";

import type { Store } from "store";

import type { AgentsClient } from "../client";
import type { DeskView } from "../desk";
import type { AttentionOffer, PointedPlace } from "../pointers";

/** The Agents module as the page reads it: the host's agents and requests, the offers agents made, and the page's own readings of places. */
export interface AgentsPageValue {
  client: AgentsClient;
  view: DeskView;
  /** What agents pointed the spec owner to, oldest first. */
  offers: readonly AttentionOffer[];
  dismissOffer: (offerId: string) => Promise<void>;
  /** A pointed unit as the spec owner reads where it is, such as "REQ-04, Requirements". */
  placeLabel: (place: PointedPlace) => string;
  /** A stage's label. */
  stageLabel: (stage: string) => string;
  /** The module the page shows, and its name while the project has modules turned on. */
  activeModuleId: string;
  activeModuleName: string | null;
  /** The model of a module the page holds; null for one it holds none of. */
  moduleStore: (moduleId: string) => Store | null;
  /** Run `run`, giving the change request of each message of the spec owner's it sends to `to`, or to none. */
  withRequestGivenTo: <Value>(to: string | null, run: () => Value) => Value;
}

export const agentsContext = createContext<AgentsPageValue | null>(null);

export function useAgents(): AgentsPageValue {
  const value = useContext(agentsContext);
  if (value == null) throw new Error("useAgents must be used inside the page's providers.");
  return value;
}
