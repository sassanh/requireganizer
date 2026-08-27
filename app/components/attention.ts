// The soft brand-tinted highlight that draws the eye to a changed element:
// one fade with a micro scale pop — the pattern used for change highlights
// across mainstream tools (GitHub's target flash, Notion's edit highlight).
// Applied through the Web Animations API so React re-renders cannot strip
// it. The presenter reports done after a short hold; this flash may still
// be running when the next change starts.

/** Run one highlight on `element`. Returns the running animation so the
 * caller can report done when it finishes (null when animation is not
 * available — the caller then completes after its own duration). */
export function pulseElement(
  element: HTMLElement,
  durationMs: number,
): Animation | null {
  if (typeof element.animate !== "function") return null;
  return element.animate(
    [
      { backgroundColor: "rgba(46, 101, 89, 0)", transform: "scale(1)" },
      {
        backgroundColor: "rgba(46, 101, 89, 0.16)",
        transform: "scale(1.012)",
        offset: 0.35,
      },
      {
        backgroundColor: "rgba(46, 101, 89, 0.06)",
        transform: "scale(1.004)",
        offset: 0.7,
      },
      { backgroundColor: "rgba(46, 101, 89, 0)", transform: "scale(1)" },
    ],
    { duration: durationMs, easing: "ease-out" },
  );
}
