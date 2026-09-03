/**
 * Central pace for every animation in the app. 1 is release speed; higher
 * runs faster, lower runs slower (0.5 doubles every duration). Relative
 * pacing between animations is preserved — a 900ms highlight stays three
 * times longer than a 300ms hold at any speed. Applies to animations
 * started after the change; anything already running keeps its pace.
 */
let speed = 1;

/** The current pace multiplier. */
export function animationSpeed(): number {
  return speed;
}

/** Set the pace for every animation. Nonsense values are ignored. */
export function setAnimationSpeed(multiplier: number): void {
  if (!Number.isFinite(multiplier) || multiplier <= 0) return;
  speed = multiplier;
}

/** Scale a millisecond duration by the current pace. */
export function animationMs(baseMs: number): number {
  return baseMs / speed;
}

/** Scale a second duration by the current pace. */
export function animationSeconds(baseSeconds: number): number {
  return baseSeconds / speed;
}
