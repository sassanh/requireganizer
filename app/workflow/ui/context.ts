"use client";

import { createContext, useContext } from "react";

import { notify } from "components/notices";
import { getUserFacingErrorMessage } from "lib/errors";

import type { Workflow } from "../definition";
import type { UnitState, WorkflowModule } from "../module";
import type { ItemVersion } from "../records";
import type { SignatureFocusMove } from "../units";

/** How bringing an earlier state back would change a unit it shows. */
export type UnitMark =
  | { change: "add" }
  | {
      change: "change";
      content: boolean;
      signature: boolean;
      threads: boolean;
      /** For an item in another place in its stage: its label there and now. */
      place: { then: string; now: string } | null;
      versionNow: ItemVersion | null;
    };

/** How bringing an earlier state back would change a thread on a unit neither state holds. */
export interface ThreadMark {
  /** The unit it was on. */
  unitId: string;
  /** The name its unit had when it was removed. */
  label: string;
  /** What its unit said when it was removed. */
  text: string;
  messagesAdded: readonly string[];
  messagesRemoved: readonly string[];
  resolutionDiffers: boolean;
  /** Whether the earlier state lacks the thread, which bringing it back would remove. */
  onlyNow: boolean;
}

/** A unit bringing an earlier state back would remove, which the earlier state lacks: shown where the project shows it now. */
export interface RemovedUnitMark {
  unitId: string;
  unitKind: UnitState["kind"];
  itemKind: string | null;
  label: string;
  textNow: string;
  /** The unit it follows; null at the start of its stage. */
  after: string | null;
}

/** What a preview of an earlier state marks in the module it shows. */
export interface PreviewMarks {
  /** How bringing the state back would change a unit it shows; null for one it leaves as it is. */
  of(unitId: string): UnitMark | null;
  /** The units of a stage it would remove. */
  removed(stage: string): readonly RemovedUnitMark[];
  /** The threads of a stage on units neither state holds that it would change, in order. */
  threads(stage: string): readonly (ThreadMark & { threadId: string })[];
  /** How many units and threads of a stage are marked. */
  count(stage: string): number;
}

/** A stage's units as a preview shows them: those of its state, with each one it would remove after the unit it follows. */
export function shownWithRemoved(shown: readonly string[], removed: readonly RemovedUnitMark[]): string[] {
  const placed = [...shown];
  for (const mark of removed) {
    const index = mark.after == null ? -1 : placed.indexOf(mark.after);
    let at = index + 1;
    while (at < placed.length && removed.some((other) => other.unitId === placed[at] && other.after === mark.after)) at += 1;
    placed.splice(at, 0, mark.unitId);
  }
  return placed;
}

/**
 * The module the page shows and the workflow it follows. With `preview`,
 * the module is an earlier state of itself: nothing in it can be changed,
 * and what bringing it back would add, change or remove is marked.
 */
export interface WorkflowView {
  module: WorkflowModule;
  workflow: Workflow;
  preview: PreviewMarks | null;
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

/**
 * Show a unit in its module and stage, focused, as a new history entry. The
 * entry left behind records `from`, the unit card or thread message it was
 * opened from, so going back focuses it again.
 */
export type OpenUnit = (place: UnitPlace, from: RevealRequest | null) => void;

/**
 * Opening a unit where an item names it. It is the same function while the
 * page shows a module, apart from the rest of the navigation, which changes
 * with every move, so what names items does not render again as the page moves.
 */
export const unitOpenerContext = createContext<OpenUnit | null>(null);

export function useOpenUnit(): OpenUnit {
  const openUnit = useContext(unitOpenerContext);
  if (openUnit == null) throw new Error("useOpenUnit must be used inside a unit opener.");
  return openUnit;
}

/** How the page moves between units and comes back to where one was opened from. */
export interface WorkflowNavigation {
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
  /** A request to give the stage itself the focus, until the page has. */
  stageFocusRequest: object | null;
  stageFocused(request: object): void;
  /** The focus moved to a unit of the stage shown, or to the stage itself for null. */
  focused(unitId: string | null): void;
  /** Make a change that sends `move` with it; resolves to the unit the change moved the focus to, null for none. */
  withFocusMove(move: SignatureFocusMove, run: () => unknown): Promise<string | null>;
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
