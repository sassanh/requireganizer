import { type FocusPlace, isFocusPlace } from "history";

/** A unit an agent points the spec owner to. */
export type PointedPlace = FocusPlace & { unitId: string };

/**
 * A set of items, coverages and impacts an agent pointed the spec owner
 * to, with the one text it gave, offered one by one until the spec owner
 * dismisses it.
 */
export interface AttentionOffer {
  id: string;
  places: PointedPlace[];
  text: string;
  /** The agent's name. */
  from: string;
}

function isAttentionOffer(value: unknown): value is AttentionOffer {
  if (value == null || typeof value !== "object") return false;
  const { id, places, text, from } = value as Record<string, unknown>;
  return (
    typeof id === "string" &&
    Array.isArray(places) &&
    places.length > 0 &&
    places.every((place) => isFocusPlace(place) && place.unitId != null) &&
    typeof text === "string" &&
    typeof from === "string"
  );
}

/** The offers a stored value keeps, oldest first; none when it keeps none or they cannot be read. */
export function parseOffers(value: unknown): AttentionOffer[] {
  if (value == null) return [];
  if (Array.isArray(value) && value.every(isAttentionOffer)) return value;
  console.error("The offers of what agents pointed to could not be read; they are dropped.");
  return [];
}
