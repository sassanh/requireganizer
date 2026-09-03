import { useEffect, useState } from "react";

let patchCount = 0;
let originalPushState: typeof window.history.pushState | null = null;
let originalReplaceState: typeof window.history.replaceState | null = null;
// Every mounted card runs this hook, so every instance must be notified —
// a single slot would only ever wake the last card that mounted.
const hashListeners = new Set<() => void>();

const readHash = () => window.location.hash.replace(/^#/, "");

function installHistoryPatch(onHashChanged: () => void) {
  if (patchCount === 0) {
    originalPushState = window.history.pushState;
    originalReplaceState = window.history.replaceState;
    window.history.pushState = function (...args) {
      originalPushState!.apply(window.history, args);
      setTimeout(() => hashListeners.forEach((listener) => listener()));
    };
    window.history.replaceState = function (...args) {
      originalReplaceState!.apply(window.history, args);
      setTimeout(() => hashListeners.forEach((listener) => listener()));
    };
  }
  hashListeners.add(onHashChanged);
  patchCount += 1;
}

function uninstallHistoryPatch(onHashChanged: () => void) {
  patchCount -= 1;
  hashListeners.delete(onHashChanged);
  if (patchCount <= 0) {
    patchCount = 0;
    if (originalPushState) window.history.pushState = originalPushState;
    if (originalReplaceState) window.history.replaceState = originalReplaceState;
    originalPushState = null;
    originalReplaceState = null;
    hashListeners.clear();
  }
}

export function useFragmentHash(): string {
  const [hash, setHash] = useState(readHash);

  useEffect(() => {
    const onHashChanged = () => setHash(readHash());

    onHashChanged();
    installHistoryPatch(onHashChanged);
    window.addEventListener("hashchange", onHashChanged);
    return () => {
      window.removeEventListener("hashchange", onHashChanged);
      uninstallHistoryPatch(onHashChanged);
    };
  }, []);

  return hash;
}
