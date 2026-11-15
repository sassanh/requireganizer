import type { FocusPlace } from "history";

/**
 * A request to show a place of the project in its module and stage with the
 * focus on it, from wherever the page is: after undo or redo, at a mark of a
 * preview, or for an offer of the coding agent's. With `leavePreview`, the
 * page shows the project now first.
 */
export interface PlaceRequest {
  place: FocusPlace;
  leavePreview: boolean;
}

const listeners = new Set<(request: PlaceRequest) => void>();

/** Ask the page showing the project to show a place, focused. */
export function requestPlace(place: FocusPlace, options: { leavePreview?: boolean } = {}): void {
  const request = { place, leavePreview: options.leavePreview ?? false };
  for (const listener of listeners) listener(request);
}

/** Show each place requested; returns a function that stops. */
export function subscribePlaceRequests(listener: (request: PlaceRequest) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let shown: FocusPlace | null = null;

/** Where the page shows the focus now, in the project now or in a preview, as the stage shown last said. */
export function shownFocus(): FocusPlace | null {
  return shown;
}

export function noteShownFocus(place: FocusPlace | null): void {
  shown = place;
}
