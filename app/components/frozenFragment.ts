import type { ReactNode } from "react";

/**
 * Last live picture of a list item. MST destroys the model as soon as it
 * leaves the collection; the list still needs that picture for the slide-out.
 */
const frozenViews = new Map<string, ReactNode>();

export function rememberFrozenFragment(id: string, node: ReactNode): void {
  frozenViews.set(id, node);
}

export function getFrozenFragment(id: string): ReactNode | null {
  return frozenViews.get(id) ?? null;
}

export function forgetFrozenFragment(id: string): void {
  frozenViews.delete(id);
}
