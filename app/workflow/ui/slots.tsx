"use client";

import { createContext, type ReactNode, useContext } from "react";

/** Where a thread's message goes: the unit and the thread, if open, and how to send it. */
export interface ThreadSendProps {
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
  /** Under an open thread's state. */
  thread?: (props: { threadId: string; preview: boolean }) => ReactNode;
  /** In place of a thread's send button, and what its send key does. */
  send?: {
    render: (props: ThreadSendProps & { label: string; disabled: boolean }) => ReactNode;
    /** What the send key does, with no choice made. */
    submit: (props: ThreadSendProps) => Promise<void>;
  };
}

export const workflowSlotsContext = createContext<WorkflowSlots>({});

type ShownSlot = "stage" | "unit" | "thread";

/** What fills a slot, or nothing while no module fills it. */
export function Slot<Name extends ShownSlot>({ name, props }: { name: Name; props: Parameters<NonNullable<WorkflowSlots[Name]>>[0] }) {
  const fill = useContext(workflowSlotsContext)[name] as ((props: unknown) => ReactNode) | undefined;
  return fill == null ? null : <>{fill(props)}</>;
}

/** The slots the page filled, such as to show a send button of its own. */
export function useWorkflowSlots(): WorkflowSlots {
  return useContext(workflowSlotsContext);
}
