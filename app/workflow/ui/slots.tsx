"use client";

import { createContext, type ReactNode, useCallback, useContext } from "react";

import { authorLabel, type Thread, type ThreadMessage, waitsForSpecOwner } from "../threads";

/** Where a thread's message goes: its stage, the unit or null for the stage itself or a unit gone, the thread, if open, and how to send it. */
export interface ThreadSendProps {
  stage: string;
  unitId: string | null;
  threadId: string | null;
  /** Sends the message written and resolves to the thread it went to, or null when nothing was sent. */
  send: () => Promise<string | null>;
}

/**
 * The places in a stage, a unit and a thread where another module shows a
 * part of its own, such as who is answering. The page fills them where it
 * composes its modules; the workflow names no module that fills them.
 */
export interface WorkflowSlots {
  /** Under a stage's header. */
  stage?: (props: { stage: string; preview: boolean }) => ReactNode;
  /** In a unit's frame, beside its actions. */
  unit?: (props: { unitId: string; preview: boolean }) => ReactNode;
  /** In a unit's frame, under its content, on lines of their own. */
  unitNotes?: (props: { unitId: string; preview: boolean }) => ReactNode;
  /** Under an open thread's state. */
  thread?: (props: { threadId: string; preview: boolean }) => ReactNode;
  /** Under a thread message, on lines of their own. */
  message?: (props: { threadId: string; messageId: string; preview: boolean }) => ReactNode;
  /**
   * Whom open threads wait for, by thread id, where another module says it
   * in place of their last message: whether the spec owner, and whom in a
   * few words, such as "Ada has it".
   */
  threadWaits?: ReadonlyMap<string, ThreadWait>;
  /** Who wrote a message, as another module names its authors, in place of the name it was written with. */
  messageAuthor?: (message: ThreadMessage) => string;
  /** In place of a thread's send button, and what its send key does. */
  send?: {
    render: (props: ThreadSendProps & { label: string; disabled: boolean }) => ReactNode;
    /** What the send key does, with no choice made. */
    submit: (props: ThreadSendProps) => Promise<void>;
  };
}

export const workflowSlotsContext = createContext<WorkflowSlots>({});

type ShownSlot = "stage" | "unit" | "unitNotes" | "thread" | "message";

/** What fills a slot, or nothing while no module fills it. */
export function Slot<Name extends ShownSlot>({ name, props }: { name: Name; props: Parameters<NonNullable<WorkflowSlots[Name]>>[0] }) {
  const fill = useContext(workflowSlotsContext)[name] as ((props: unknown) => ReactNode) | undefined;
  return fill == null ? null : <>{fill(props)}</>;
}

/** The slots the page filled, such as to show a send button of its own. */
export function useWorkflowSlots(): WorkflowSlots {
  return useContext(workflowSlotsContext);
}

/** Whom an open thread waits for: whether the spec owner, and whom in a few words. */
export interface ThreadWait {
  forSpecOwner: boolean;
  who: string;
}

const NO_WAITS: ReadonlyMap<string, ThreadWait> = new Map();

/**
 * Whom an open thread waits for, with what the page's modules say of it:
 * the one reading behind every mark, count and row of threads waiting for
 * the spec owner.
 */
export function useThreadWait(): (thread: Thread) => ThreadWait {
  const said = useContext(workflowSlotsContext).threadWaits ?? NO_WAITS;
  return useCallback(
    (thread: Thread) => {
      const wait = said.get(thread.id);
      const forSpecOwner = waitsForSpecOwner(thread, wait?.forSpecOwner);
      return { forSpecOwner, who: wait?.who ?? (forSpecOwner ? "Waits for you" : "Waits for a reply") };
    },
    [said],
  );
}

/** Whether an open thread waits for the spec owner, as `useThreadWait` reads it. */
export function useWaitsForSpecOwner(): (thread: Thread) => boolean {
  const waitOf = useThreadWait();
  return useCallback((thread: Thread) => waitOf(thread).forSpecOwner, [waitOf]);
}

/** Who wrote a message, as `messageAuthor` names it, or by the name it was written with. */
export function useAuthorLabel(): (message: ThreadMessage) => string {
  const named = useContext(workflowSlotsContext).messageAuthor;
  return useCallback((message: ThreadMessage) => named?.(message) ?? authorLabel(message.author), [named]);
}
