"use client";

import { createContext, type RefObject, useContext, useEffect, useLayoutEffect, useState } from "react";
import { flushSync } from "react-dom";

/** The height a frame takes until its content shows: about that of a unit of a few lines. */
export const FRAME_PLACEHOLDER_HEIGHT = 240;
/** No unit is shorter than this, so a window never shows more frames than its height holds of these. */
const SHORTEST_FRAME_HEIGHT = 120;
/** How long the frames still to show may keep the page busy at a time, and how many show together. */
const FILL_BUDGET_MS = 10;
const FILL_BATCH = 2;
/** The longest the next frames wait for the page to be idle. */
const FILL_WAIT_MS = 200;

/** Run once the page is idle, or after the longest wait; returns the way to call it off. */
export function whenIdle(run: () => void): () => void {
  if (typeof requestIdleCallback === "function") {
    const request = requestIdleCallback(run, { timeout: FILL_WAIT_MS });
    return () => cancelIdleCallback(request);
  }
  const timer = setTimeout(run, 32);
  return () => clearTimeout(timer);
}

/**
 * When each frame of a stage shows its content. Showing the content of
 * hundreds of units at once keeps the page busy for long, so only the frames
 * a window can show do so from the start. A frame that comes near the part
 * of the stage on screen shows its content then, and the others show theirs
 * a few at a time while the page is idle, until every frame shows it. Until
 * then a frame keeps a placeholder's height, so the stage scrolls as a whole
 * from the start.
 */
export class FrameSchedule {
  private readonly first: ReadonlySet<string>;
  /** The frames whose content is still to show, in the order they are on the page. */
  private readonly waiting = new Map<Element, () => void>();
  private observer: IntersectionObserver | null = null;
  private callOffFill: (() => void) | null = null;
  private filled = false;

  /**
   * `units` are the stage's units in the order it shows them, and `revealed`
   * the unit the page is about to reveal, if any.
   */
  constructor(units: readonly string[], revealed: string | null) {
    const count = Math.ceil(window.innerHeight / SHORTEST_FRAME_HEIGHT) + 2;
    const from = Math.max(0, (revealed == null ? 0 : units.indexOf(revealed)) - 2);
    this.first = new Set(units.slice(from, from + count));
  }

  /** Whether a unit's frame shows its content from its first render. */
  startsShown(unitId: string): boolean {
    return this.filled || this.first.has(unitId);
  }

  /**
   * Start showing frames as they come near the part of `root`, the element
   * the stage scrolls in, that is on screen, and the others while the page
   * is idle. Frames are watched from their first render, before `root` is
   * there, so the schedule starts once it is.
   */
  start(root: Element): void {
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) this.show(entry.target);
        }
      },
      // A window's height around the part on screen, so scrolling meets content, not placeholders.
      { root, rootMargin: "100% 0px" },
    );
    for (const frame of this.waiting.keys()) this.observer.observe(frame);
    this.callOffFill = whenIdle(this.fill);
  }

  /** Call `show` once the frame is to show its content; returns the way to stop waiting for it. */
  watch(frame: Element, show: () => void): () => void {
    this.waiting.set(frame, show);
    this.observer?.observe(frame);
    if (this.observer != null) this.callOffFill ??= whenIdle(this.fill);
    return () => this.forget(frame);
  }

  /** Show a frame's content now; whether it was still to show. */
  show(frame: Element): boolean {
    const show = this.waiting.get(frame);
    if (show == null) return false;
    this.forget(frame);
    show();
    return true;
  }

  /** Stop showing frames, such as once the stage is left. */
  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.callOffFill?.();
    this.callOffFill = null;
    this.waiting.clear();
  }

  private forget(frame: Element): void {
    this.waiting.delete(frame);
    this.observer?.unobserve(frame);
  }

  private readonly fill = (): void => {
    this.callOffFill = null;
    const started = performance.now();
    while (this.waiting.size > 0 && performance.now() - started < FILL_BUDGET_MS) {
      // Rendered at once, so the time each batch took is known before the next starts.
      flushSync(() => {
        const frames = this.waiting.keys();
        for (let shown = 0; shown < FILL_BATCH; shown += 1) {
          const next = frames.next();
          if (next.done === true) break;
          this.show(next.value);
        }
      });
    }
    if (this.waiting.size > 0) this.callOffFill = whenIdle(this.fill);
    else this.filled = true;
  };
}

const frameScheduleContext = createContext<FrameSchedule | null>(null);

export const FrameScheduleProvider = frameScheduleContext.Provider;

/** Whether a unit's frame shows its content yet. Outside a schedule it always does. */
export function useFrameContentShown(unitId: string, frame: RefObject<Element | null>): boolean {
  const schedule = useContext(frameScheduleContext);
  const [shown, setShown] = useState(() => schedule?.startsShown(unitId) ?? true);
  useLayoutEffect(() => {
    if (shown || schedule == null || frame.current == null) return;
    return schedule.watch(frame.current, () => setShown(true));
  }, [shown, schedule, frame]);
  return shown;
}

/**
 * Whether the page has been idle since `key` was first given, so a view can
 * show what is costly to work out once the rest of it shows; at once for null.
 */
export function useIdleSince(key: object | null): boolean {
  const [idleFor, setIdleFor] = useState<object | null>(null);
  useEffect(() => {
    if (key == null || idleFor === key) return;
    return whenIdle(() => setIdleFor(key));
  }, [key, idleFor]);
  return key == null || idleFor === key;
}
