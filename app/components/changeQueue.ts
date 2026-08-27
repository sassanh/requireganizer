import { useLayoutEffect, useRef, useState } from "react";

import {
  claim,
  complete,
  getPresentationTick,
  isPresenting,
  resetPresentation,
} from "presentation";

import { pulseElement } from "./attention";
import { scrollIntoViewWithMargin } from "./scrollFollower";

/**
 * How long one highlight animation runs visually. Presenters report done
 * after HIGHLIGHT_HOLD_MILLISECONDS so the next change can start while
 * this flash finishes.
 */
export const HIGHLIGHT_MILLISECONDS = 900;

/** How long a presenter holds the sequencer before reporting done. */
export const HIGHLIGHT_HOLD_MILLISECONDS = 300;

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
  const sessionRef = useRef({
    tick: 0,
    completed: true,
    alive: false,
  });

  useLayoutEffect(() => {
    if (isEqual(committed, displayedRef.current)) return;

    if (!isPresenting()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- snap to committed when not presenting
      setDisplayed(committed);
      return;
    }

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
    if (node != null) scrollIntoViewWithMargin(node);
    setDisplayed(committed);
    const anim = node != null ? pulseElement(node, HIGHLIGHT_MILLISECONDS) : null;

    let finished = false;
    const finish = () => {
      if (finished) return;
      if (session.completed || session.tick !== tick) return;
      finished = true;
      session.completed = true;
      complete(tick);
    };
    const doFinish = () => {
      if (finished) return;
      finish();
    };
    let hold: ReturnType<typeof setTimeout> | null = setTimeout(
      doFinish,
      HIGHLIGHT_HOLD_MILLISECONDS,
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

    return () => {
      if (hold != null) clearTimeout(hold);
      session.alive = false;
      queueMicrotask(() => {
        if (!session.alive && !session.completed && session.tick === tick) {
          session.completed = true;
          complete(tick);
        }
      });
    };
  }, [committed, elementId, isEqual]);

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
