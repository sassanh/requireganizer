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

/** A message of a thread, by the thread and the message's place in it. */
export interface MessagePlace {
  threadId: string;
  index: number;
}

/** What the page focuses and reveals once it shows: a unit's card, or a message of a thread on the unit. */
export interface RevealRequest {
  unitId: string;
  message: MessagePlace | null;
}

const THREAD_ATTRIBUTE = "data-thread";
const MESSAGE_ATTRIBUTE = "data-thread-message";

/** The attributes that mark an element as a thread message, so an item opened from inside it returns to it. */
export function messageAttributes(thread: { id: string; unitId: string }, index: number): Record<string, string> {
  return { [THREAD_ATTRIBUTE]: thread.id, [MESSAGE_ATTRIBUTE]: String(index), "data-message-unit": thread.unitId };
}

/** The element showing a thread message, inside `root`, if it shows. */
export function messageElement(root: ParentNode, message: MessagePlace): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[${THREAD_ATTRIBUTE}="${CSS.escape(message.threadId)}"][${MESSAGE_ATTRIBUTE}="${message.index}"]`);
}

/** Where an element shows: in a thread message, or else in a unit's card; null anywhere else. */
export function placeOf(element: Element): RevealRequest | null {
  const message = element.closest<HTMLElement>(`[${MESSAGE_ATTRIBUTE}]`);
  if (message != null) {
    return { unitId: message.dataset.messageUnit!, message: { threadId: message.dataset.thread!, index: Number(message.dataset.threadMessage) } };
  }
  const card = element.closest<HTMLElement>("[data-unit-card]")?.dataset.unitCard;
  return card == null ? null : { unitId: card, message: null };
}

/** How the page moves between units: opening one where an item names it, and coming back to where it was opened from. */
export interface WorkflowNavigation {
  /**
   * Show a unit in its module and stage, focused, as a new history entry.
   * The entry left behind records `from`, the unit card or thread message it
   * was opened from, so going back focuses it again.
   */
  openUnit(place: UnitPlace, from: RevealRequest | null): void;
  /**
   * Where the unit shown was opened from, while the page can go back there:
   * the unit card or thread message, or null for elsewhere on the page; the
   * whole is null when the shown entry was not opened from a named item.
   */
  opener: { place: RevealRequest | null } | null;
  /** Go back to where the unit shown was opened from, as the browser's history holds it. */
  returnToOpener(): void;
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
