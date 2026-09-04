import { useCallback, useLayoutEffect, useRef, useState } from "react";

import type { ApprovalStatus } from "contract-domain";
import {
  claim,
  complete,
  getPresentationTick,
  isPresenting,
  resetPresentation,
} from "presentation";

import { presentationMs } from "./animation";
import {
  animateApprovalBar,
  pulsePresentationElement,
  settleApprovalBar,
} from "./attention";
import { scrollPresentationIntoView } from "./scrollFollower";

/**
 * How long one highlight animation runs visually. Presenters report done
 * after HIGHLIGHT_HOLD_MILLISECONDS so the next change can start while
 * this flash finishes.
 */
export const HIGHLIGHT_MILLISECONDS = 900;

/** How long a presenter holds the sequencer before reporting done. */
export const HIGHLIGHT_HOLD_MILLISECONDS = 300;

/**
 * Single gate for presentation turns. Every staged presenter that wants to
 * animate prev→next must claim the current tick and later complete it. The
 * helper owns scroll-into-view, session liveness, and the safety microtask
 * so no caller can forget it and diverge.
 */
export function usePresentationTurn(elementId: string | undefined) {
  const sessionRef = useRef({ tick: 0, completed: true, alive: false });

  const claimTurn = useCallback((): number | null => {
    if (!isPresenting()) return null;
    const tick = getPresentationTick();
    const session = sessionRef.current;
    session.alive = true;
    if (session.tick !== tick || session.completed) {
      claim(tick);
      session.tick = tick;
      session.completed = false;
    }
    const node =
      elementId != null ? document.getElementById(elementId) : null;
    if (node != null) scrollPresentationIntoView(node);
    return tick;
  }, [elementId]);

  const completeTurn = useCallback((tick: number) => {
    const session = sessionRef.current;
    if (session.completed || session.tick !== tick) return;
    session.completed = true;
    complete(tick);
  }, []);

  const createCleanup = useCallback(
    (tick: number, clear: () => void) => {
      return () => {
        clear();
        const session = sessionRef.current;
        session.alive = false;
        queueMicrotask(() => {
          if (!session.alive && !session.completed && session.tick === tick) {
            session.completed = true;
            complete(tick);
          }
        });
      };
    },
    [],
  );

  return { claimTurn, completeTurn, createCleanup };
}

/**
 * Show committed (from the presentation replica). When the sequencer is
 * applying a frame, claim, animate prev→next, complete. Idle updates paint
 * immediately. Presenters do not schedule turns and do not wait on a queue.
 */
export function useStagedContent<Value>(
  _subject: string | undefined,
  elementId: string | undefined,
  committed: Value,
  isEqual: (left: Value, right: Value) => boolean = Object.is,
): Value {
  const [displayed, setDisplayed] = useState(committed);
  const displayedRef = useRef(displayed);
  // eslint-disable-next-line react-hooks/refs -- sync ref for effect comparison
  displayedRef.current = displayed;
  const { claimTurn, completeTurn, createCleanup } =
    usePresentationTurn(elementId);

  useLayoutEffect(() => {
    if (isEqual(committed, displayedRef.current)) return;

    const tick = claimTurn();
    if (tick == null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- snap when idle
      setDisplayed(committed);
      return;
    }

    const node =
      elementId != null ? document.getElementById(elementId) : null;
    setDisplayed(committed);
    const anim = node != null ? pulsePresentationElement(node, HIGHLIGHT_MILLISECONDS) : null;

    let finished = false;
    const doFinish = () => {
      if (finished) return;
      finished = true;
      completeTurn(tick);
    };
    let hold: ReturnType<typeof setTimeout> | null = setTimeout(
      doFinish,
      presentationMs(HIGHLIGHT_HOLD_MILLISECONDS),
    );
    if (anim?.finished != null) {
      anim.finished
        .then(() => {
          if (hold != null) clearTimeout(hold);
          doFinish();
        })
        .catch(() => {
          if (hold != null) clearTimeout(hold);
          doFinish();
        });
    }

    return createCleanup(tick, () => {
      if (hold != null) clearTimeout(hold);
    });
  }, [committed, elementId, isEqual, claimTurn, completeTurn, createCleanup]);

  return displayed;
}

/**
 * Stage the approval stamp the same way fields stage their values: snap
 * when idle, claim the current tick while presenting, sweep the bar, then
 * complete so the sequencer can move on.
 */
export function useStagedApproval(
  elementId: string,
  committed: ApprovalStatus,
): ApprovalStatus {
  const [displayed, setDisplayed] = useState(committed);
  const displayedRef = useRef(displayed);
  // eslint-disable-next-line react-hooks/refs -- sync for next effect
  displayedRef.current = displayed;
  const { claimTurn, completeTurn, createCleanup } =
    usePresentationTurn(elementId);

  useLayoutEffect(() => {
    if (committed === displayed) {
      settleApprovalBar(document.getElementById(elementId));
    }
  }, [committed, displayed, elementId]);

  useLayoutEffect(() => {
    if (committed === displayedRef.current) return;

    const tick = claimTurn();
    if (tick == null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- snap when idle
      setDisplayed(committed);
      return;
    }

    const node = document.getElementById(elementId);
    const anim =
      node != null
        ? animateApprovalBar(node, committed, HIGHLIGHT_MILLISECONDS)
        : null;

    let finished = false;
    const doFinish = () => {
      if (finished) return;
      finished = true;
      setDisplayed(committed);
      completeTurn(tick);
    };
    let hold: ReturnType<typeof setTimeout> | null = setTimeout(
      doFinish,
      presentationMs(HIGHLIGHT_MILLISECONDS),
    );
    if (anim?.finished != null) {
      anim.finished
        .then(() => {
          if (hold != null) clearTimeout(hold);
          doFinish();
        })
        .catch(() => {
          if (hold != null) clearTimeout(hold);
          doFinish();
        });
    }

    return createCleanup(tick, () => {
      if (hold != null) clearTimeout(hold);
    });
  }, [committed, elementId, claimTurn, completeTurn, createCleanup]);

  return displayed;
}

/** Structural equality for staged artifact snapshots. */
export function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Drop presentation state. Used on project load and by tests. */
export function resetChangeQueue(): void {
  resetPresentation();
}
