/**
 * Central pace for every animation in the app. 1 is release speed; higher
 * runs faster, lower runs slower (0.5 doubles every duration). Relative
 * pacing between animations is preserved — a 900ms highlight stays three
 * times longer than a 300ms hold at any speed. Applies to animations
 * started after the change; anything already running keeps its pace.
 *
 * Playing items (the staged highlights, slides, and text changes) add
 * the presenting tick's rush on top through presentationMs/presentationSeconds.
 * Everyday touches (buttons, chat) stay on the manual speed through
 * animationMs/animationSeconds.
 */
import { getPresentationPace } from "presentation/momentum";

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

/** Scale a millisecond duration by the manual pace and the tick's rush. */
export function presentationMs(baseMs: number): number {
  return animationMs(baseMs) / getPresentationPace();
}

/** Scale a second duration by the manual pace and the tick's rush. */
export function presentationSeconds(baseSeconds: number): number {
  return animationSeconds(baseSeconds) / getPresentationPace();
}
