/**
 * How a scroll the page starts on the person's behalf behaves: smooth, unless
 * the person asked their system for reduced motion, when it stays a jump.
 */
export function autoScrollBehavior(): ScrollBehavior {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}
