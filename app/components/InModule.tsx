"use client";

import { type ReactNode, useCallback, useMemo } from "react";

import { requestPlace } from "lib/placeRequests";
import type { Store } from "store";
import { type OpenUnit, unitOpenerContext, workflowViewContext } from "workflow/ui";

/**
 * What shows a module's units and threads away from the stage the page
 * shows, such as a list of them, read in that module: opening a unit or a
 * thread there shows it in its module and stage in the project now, after
 * `onLeave`.
 */
export default function InModule({ store, moduleId, onLeave, children }: { store: Store; moduleId: string; onLeave?: () => void; children: ReactNode }) {
  const view = useMemo(() => ({ module: store, workflow: store.workflow, preview: null }), [store]);
  const openUnit = useCallback<OpenUnit>(
    (place) => {
      onLeave?.();
      requestPlace({ moduleId: place.module ?? moduleId, stage: place.stage, unitId: place.unitId }, { leavePreview: true, message: place.message ?? null });
    },
    [moduleId, onLeave],
  );
  return (
    <workflowViewContext.Provider value={view}>
      <unitOpenerContext.Provider value={openUnit}>{children}</unitOpenerContext.Provider>
    </workflowViewContext.Provider>
  );
}
