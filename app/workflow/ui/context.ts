"use client";

import { createContext, useContext } from "react";

import { notify } from "components/notices";
import { getUserFacingErrorMessage } from "lib/errors";

import type { Workflow } from "../definition";
import type { WorkflowModule } from "../module";

/** The module the page shows and the workflow it follows. */
export interface WorkflowView {
  module: WorkflowModule;
  workflow: Workflow;
}

export const workflowViewContext = createContext<WorkflowView | null>(null);

export function useWorkflowView(): WorkflowView {
  const view = useContext(workflowViewContext);
  if (view == null) throw new Error("useWorkflowView must be used inside a workflow view.");
  return view;
}

/** Where a unit shows: its module, or null for the module the page shows, its stage, and the unit. */
export interface UnitPlace {
  module: string | null;
  stage: string;
  unitId: string;
}

/** A unit the page focuses and reveals once its card shows. */
export interface RevealRequest {
  unitId: string;
}

/** How the page moves between units: opening one where an item names it, and coming back by the browser's history. */
export interface WorkflowNavigation {
  /**
   * Show a unit in its module and stage, focused, as a new history entry.
   * The entry left behind records `from`, the unit it was opened from, so
   * going back focuses that unit again.
   */
  openUnit(place: UnitPlace, from: string | null): void;
  /** The unit to reveal, until the page has revealed it. */
  revealRequest: RevealRequest | null;
  revealed(request: RevealRequest): void;
}

export const workflowNavigationContext = createContext<WorkflowNavigation | null>(null);

export function useWorkflowNavigation(): WorkflowNavigation {
  const navigation = useContext(workflowNavigationContext);
  if (navigation == null) throw new Error("useWorkflowNavigation must be used inside a workflow navigation.");
  return navigation;
}

/**
 * Run a module action and report its failure. On a replica an action is a
 * request to the project host, settled once the replica shows its result.
 */
export async function perform(action: () => unknown, failure: string): Promise<boolean> {
  try {
    await action();
    return true;
  } catch (error) {
    notify(getUserFacingErrorMessage(error, failure), "error");
    return false;
  }
}
