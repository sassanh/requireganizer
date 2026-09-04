import { getPresentationTick } from "presentation";

import { animationMs, presentationMs } from "./animation";
import { ITEM_MOTION_SECONDS } from "./itemMotion";

/** How long the scroll pursuit follows an element before settling: long
 * enough to carry it through its own slide-in. */
const PURSUIT_SECONDS = ITEM_MOTION_SECONDS + 0.3;

/** How far from the viewport edges an item must sit to count as visible;
 * anything hugging an edge gets scrolled to center before its slot. */
export const MARGIN_PIXELS = 96;

/** How aggressively the pursuit eases toward the target each frame. */
const PURSUIT_FACTOR = 0.22;

/** The nearest scrollable ancestor, or null when the page itself scrolls. */
export function scrollableAncestor(element: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = element.parentElement;
  while (node != null && node !== document.body) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
    node = node.parentElement;
  }
  return null;
}

let activeFrame: number | null = null;
let activeTick: number | null = null;

function cancelScroll(): void {
  if (activeFrame != null) cancelAnimationFrame(activeFrame);
  activeFrame = null;
  activeTick = null;
}

export type ScrollFit = "center" | "nearest";

function maxScrollTop(container: HTMLElement | null): number {
  if (container == null) {
    return Math.max(
      0,
      document.documentElement.scrollHeight - window.innerHeight,
    );
  }
  return Math.max(0, container.scrollHeight - container.clientHeight);
}

function viewportMetrics(
  element: HTMLElement,
  container: HTMLElement | null,
): { top: number; projectedHeight: number; viewportHeight: number } {
  const viewportHeight = container?.clientHeight ?? window.innerHeight;
  const containerTop = container?.getBoundingClientRect().top ?? 0;
  const rect = element.getBoundingClientRect();
  const top = rect.top - containerTop;
  const projectedHeight = Math.max(rect.height, element.scrollHeight);
  return { top, projectedHeight, viewportHeight };
}

function isFullyVisible(
  element: HTMLElement,
  container: HTMLElement | null,
  margin = 0,
): boolean {
  const { top, projectedHeight, viewportHeight } = viewportMetrics(
    element,
    container,
  );
  return top - margin >= 0 && top + projectedHeight + margin <= viewportHeight;
}

/**
 * Keep `element` fully in view — with a meaningful margin from the edges —
 * while its animation slot plays. This is a pursuit, not a one-shot
 * scroll, for two reasons: while earlier wave items are still growing, the
 * item's position keeps shifting under it; and until the item itself
 * grows, the document may be too short for the target scroll to even
 * exist (the browser clamps it) — the scrollroom only opens up as the
 * item grows. So each frame re-measures the item's projected geometry
 * (its natural content height — a wave addition is still collapsed) and
 * eases the scroll toward it, following the item through its slide.
 *
 * Stop once the node is gone or fully collapsed: a detached rect is
 * zeros and must not be treated as "scroll to the top". Clamp the
 * target so a last item cannot be centered past the end of the list.
 *
 * `nearest` only moves the camera if the element is clipped. Last-item
 * slide-outs are already on screen; centering them was a jump before
 * each exit.
 */
export function scrollIntoViewWithMargin(
  element: HTMLElement,
  fit: ScrollFit = "center",
  margin = 0,
): void {
  scrollWithDuration(
    element,
    fit,
    margin,
    animationMs(PURSUIT_SECONDS * 1000),
    true,
  );
}

/** Follow a playing item through its slot: manual pace plus queue rush. */
export function scrollPresentationIntoView(
  element: HTMLElement,
  fit: ScrollFit = "center",
  margin = 0,
): void {
  scrollWithDuration(
    element,
    fit,
    margin,
    presentationMs(PURSUIT_SECONDS * 1000),
    false,
  );
}

function scrollWithDuration(
  element: HTMLElement,
  fit: ScrollFit,
  margin: number,
  duration: number,
  restart: boolean,
): void {
  // One camera move per presentation tick: whoever asks first aims, later
  // joiners on the same tick (the card, then its text) ride along instead
  // of killing the pursuit and re-aiming mid-slide. Manual moves always
  // take over.
  const tickNow = getPresentationTick();
  if (!restart && activeFrame != null && activeTick === tickNow) {
    return;
  }
  cancelScroll();
  activeTick = getPresentationTick();
  if (!element.isConnected) return;
  const container = scrollableAncestor(element);
  if (fit === "nearest" && isFullyVisible(element, container, margin)) return;

  const startedAt = performance.now();
  const step = (now: number): void => {
    if (now - startedAt >= duration || !element.isConnected) {
      activeFrame = null;
      activeTick = null;
      return;
    }
    const { top, projectedHeight, viewportHeight } = viewportMetrics(
      element,
      container,
    );
    if (projectedHeight <= 0) {
      activeFrame = null;
      activeTick = null;
      return;
    }
    const projectedBottom = top + projectedHeight;
    const from = container?.scrollTop ?? window.scrollY;
    let unclamped = from;
    if (fit === "nearest") {
      if (top - margin < 0) unclamped = from + top - margin;
      else if (projectedBottom + margin > viewportHeight) {
        unclamped = from + projectedBottom + margin - viewportHeight;
      } else {
        activeFrame = requestAnimationFrame(step);
        return;
      }
    } else if (
      top < MARGIN_PIXELS ||
      projectedBottom > viewportHeight - MARGIN_PIXELS
    ) {
      const comfortableHeight = viewportHeight - 2 * MARGIN_PIXELS;
      const offsetWithinViewport =
        projectedHeight >= comfortableHeight
          ? MARGIN_PIXELS
          : (viewportHeight - projectedHeight) / 2;
      unclamped = from + top - offsetWithinViewport;
    } else {
      activeFrame = requestAnimationFrame(step);
      return;
    }
    const target = Math.max(0, Math.min(maxScrollTop(container), unclamped));
    if (Math.abs(target - from) >= 0.5) {
      const value = from + (target - from) * PURSUIT_FACTOR;
      if (container == null) window.scrollTo(0, value);
      else container.scrollTop = value;
    }
    activeFrame = requestAnimationFrame(step);
  };
  activeFrame = requestAnimationFrame(step);
}
