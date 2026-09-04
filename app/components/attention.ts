// The soft brand-tinted highlight that draws the eye to a changed element:
// a background fade, no scale — scaling a tall block (a whole stage)
// grows the page and the scroll pursuit chases it. Applied through the
// Web Animations API so React re-renders cannot strip it. The presenter
// reports done after a short hold; this flash may still be running when
// the next change starts.
import { animationMs, presentationMs } from "./animation";

const HIGHLIGHT_KEYFRAMES: Keyframe[] = [
  { backgroundColor: "rgba(46, 101, 89, 0)" },
  { backgroundColor: "rgba(46, 101, 89, 0.16)", offset: 0.35 },
  { backgroundColor: "rgba(46, 101, 89, 0.06)", offset: 0.7 },
  { backgroundColor: "rgba(46, 101, 89, 0)" },
];

function runHighlight(
  element: HTMLElement,
  durationMs: number,
): Animation | null {
  if (typeof element.animate !== "function") return null;
  return element.animate(HIGHLIGHT_KEYFRAMES, {
    duration: durationMs,
    easing: "ease-out",
  });
}

/** Everyday highlight (copy confirmation, link jump): manual pace only. */
export function pulseElement(
  element: HTMLElement,
  durationMs: number,
): Animation | null {
  return runHighlight(element, animationMs(durationMs));
}

/** Playing-item highlight: manual pace plus the queue's rush. */
export function pulsePresentationElement(
  element: HTMLElement,
  durationMs: number,
): Animation | null {
  return runHighlight(element, presentationMs(durationMs));
}

function approvalStampColor(
  bar: HTMLElement,
  status: "draft" | "approved",
): string {
  const property =
    status === "approved"
      ? "--mui-palette-success-main"
      : "--mui-palette-action-disabled";
  return (
    getComputedStyle(bar).getPropertyValue(property).trim() ||
    (status === "approved" ? "rgb(46, 125, 50)" : "rgba(255, 255, 255, 0.3)")
  );
}

function cancelNodeAnimations(node: HTMLElement): void {
  if (typeof node.getAnimations !== "function") return;
  for (const animation of node.getAnimations()) animation.cancel();
}

/** Drop WAAPI leftover so the CSS stamp is the only paint. */
export function settleApprovalBar(element: HTMLElement | null): void {
  if (element == null) return;
  const bar = element.querySelector("[data-approval-bar]");
  const fill = element.querySelector("[data-approval-bar-fill]");
  const sweep = element.querySelector("[data-approval-bar-sweep]");
  if (
    !(bar instanceof HTMLElement) ||
    !(fill instanceof HTMLElement) ||
    !(sweep instanceof HTMLElement)
  ) {
    return;
  }
  cancelNodeAnimations(bar);
  cancelNodeAnimations(fill);
  cancelNodeAnimations(sweep);
  bar.style.backgroundColor = "";
  fill.style.backgroundColor = "";
  fill.style.transform = "";
  fill.style.transformOrigin = "";
  sweep.style.transform = "";
  sweep.style.transformOrigin = "";
}

/** Approve: green fills top → bottom. Unapprove: empties bottom → top.
 * Glow rides that same stroke and fades out. A playing-item animation:
 * the manual pace plus the queue's rush apply inside. */
export function animateApprovalBar(
  element: HTMLElement,
  nextStatus: "draft" | "approved",
  durationMs: number,
): Animation | null {
  const bar = element.querySelector("[data-approval-bar]");
  const fill = element.querySelector("[data-approval-bar-fill]");
  const sweep = element.querySelector("[data-approval-bar-sweep]");
  if (
    !(bar instanceof HTMLElement) ||
    !(fill instanceof HTMLElement) ||
    !(sweep instanceof HTMLElement) ||
    typeof fill.animate !== "function"
  ) {
    return null;
  }

  cancelNodeAnimations(bar);
  cancelNodeAnimations(fill);
  cancelNodeAnimations(sweep);

  const approving = nextStatus === "approved";
  fill.style.transformOrigin = "top";
  sweep.style.transformOrigin = "top";
  fill.style.backgroundColor = approvalStampColor(bar, "approved");
  if (!approving) {
    bar.style.backgroundColor = approvalStampColor(bar, "draft");
  }

  const stroke = approving
    ? [{ transform: "scaleY(0)" }, { transform: "scaleY(1)" }]
    : [{ transform: "scaleY(1)" }, { transform: "scaleY(0)" }];
  const glow = approving
    ? [
        { transform: "scaleY(0)", opacity: 0.55 },
        { transform: "scaleY(1)", opacity: 0 },
      ]
    : [
        { transform: "scaleY(1)", opacity: 0.55 },
        { transform: "scaleY(0)", opacity: 0 },
      ];
  const timing = { duration: presentationMs(durationMs), easing: "ease-in-out" as const };

  fill.animate(stroke, { ...timing, fill: "forwards" });
  return sweep.animate(glow, timing);
}
