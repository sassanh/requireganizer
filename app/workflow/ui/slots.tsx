"use client";

import { createContext, type ReactNode, useContext } from "react";

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
  /** The threads whose change request an agent has, which therefore wait for no one but that agent. */
  threadsWithAgent?: ReadonlySet<string>;
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

const NO_THREADS: ReadonlySet<string> = new Set();

/** The threads whose change request an agent has, as the page that fills the slots says; none while no module says. */
export function useThreadsWithAgent(): ReadonlySet<string> {
  return useContext(workflowSlotsContext).threadsWithAgent ?? NO_THREADS;
}
