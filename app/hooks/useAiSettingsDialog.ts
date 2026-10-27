import { useEffect, useState } from "react";

import { PROJECT_HOST_LOCATION } from "deployment";
import { needsAiSettingsPrompt } from "lib/aiSettingsPrompt";
import { browserAiSettings } from "lib/aiSettingsStorage";

export interface AiSettingsDialogState {
  open: boolean;
  show(): void;
  close(): void;
}

/** Whether this page load already offered AI settings; a later screen does not ask again. */
let offeredThisPageLoad = false;

/**
 * The AI settings dialog's open state. In the browser build it opens on the
 * first screen that mounts while no API key is configured, since no AI action
 * can run until the person adds one.
 */
export function useAiSettingsDialog(): AiSettingsDialogState {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (offeredThisPageLoad) return;
    offeredThisPageLoad = true;
    if (needsAiSettingsPrompt(PROJECT_HOST_LOCATION, browserAiSettings.read().apiKey)) {
      // The dialog can only be offered after hydration, when browser storage
      // exists; the effect is what opens it, not a render-time calculation.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(true);
    }
  }, []);

  return {
    open,
    show: () => setOpen(true),
    close: () => setOpen(false),
  };
}
