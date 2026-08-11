import { useEffect, useState } from "react";

let patchCount = 0;
let originalPushState: typeof window.history.pushState | null = null;
let originalReplaceState: typeof window.history.replaceState | null = null;
let notifyHashChanged: (() => void) | null = null;

const readHash = () => window.location.hash.replace(/^#/, "");

function installHistoryPatch(onHashChanged: () => void) {
  if (patchCount === 0) {
    originalPushState = window.history.pushState;
    originalReplaceState = window.history.replaceState;
    window.history.pushState = function (...args) {
      originalPushState!.apply(window.history, args);
      setTimeout(() => notifyHashChanged?.());
    };
    window.history.replaceState = function (...args) {
      originalReplaceState!.apply(window.history, args);
      setTimeout(() => notifyHashChanged?.());
    };
  }
  notifyHashChanged = onHashChanged;
  patchCount += 1;
}

function uninstallHistoryPatch(onHashChanged: () => void) {
  patchCount -= 1;
  if (notifyHashChanged === onHashChanged) {
    notifyHashChanged = null;
  }
  if (patchCount <= 0) {
    patchCount = 0;
    if (originalPushState) window.history.pushState = originalPushState;
    if (originalReplaceState) window.history.replaceState = originalReplaceState;
    originalPushState = null;
    originalReplaceState = null;
    notifyHashChanged = null;
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
