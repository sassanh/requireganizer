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
