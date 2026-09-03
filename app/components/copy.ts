/**
 * Copy text providers, keyed by artifact element id. Each approvable
 * frame registers a function that renders its own content as nicely
 * formatted plain text; the copy shortcut looks the selected frame's
 * provider up instead of every item type funneling through one branch.
 */
const providers = new Map<string, () => string>();

export function registerCopyProvider(
  elementId: string,
  provide: () => string,
): () => void {
  providers.set(elementId, provide);
  return () => {
    if (providers.get(elementId) === provide) providers.delete(elementId);
  };
}

export function copyTextForElement(elementId: string): string | null {
  return providers.get(elementId)?.() ?? null;
}
