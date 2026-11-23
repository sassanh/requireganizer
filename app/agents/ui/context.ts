"use client";

import { createContext, useContext } from "react";

import type { AgentsClient } from "../client";
import type { AgentsView } from "../view";

/** The Agents module as the page reads it: the host's agents and templates, and the actions on them. */
export interface AgentsPageValue {
  client: AgentsClient;
  view: AgentsView;
}

export const agentsContext = createContext<AgentsPageValue | null>(null);

export function useAgents(): AgentsPageValue {
  const value = useContext(agentsContext);
  if (value == null) throw new Error("useAgents must be used inside the page's providers.");
  return value;
}
