"use client";

import { Divider, Stack } from "@mui/material";
import { observer } from "mobx-react-lite";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { stepHref, unitHref } from "lib/routes";
import { rememberedStage, rememberStage } from "lib/viewState";
import { useProject } from "projectContext";
import { useStore } from "store";
import { type RevealRequest, StageNavigation, StageView, type WorkflowNavigation, workflowNavigationContext, workflowViewContext } from "workflow/ui";

/** The unit an address focuses, to reveal once its card shows. */
function revealRequestOf(search: URLSearchParams): RevealRequest | null {
  const unitId = search.get("unit");
  return unitId == null ? null : { unitId };
}

/** The open module: its stages beside the one the page shows. */
const Factory = observer(function Factory() {
  const store = useStore();
  const { activeProject, modulesEnabled, activeModuleId } = useProject();
  const projectId = activeProject?.id ?? "";
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const workflow = store.workflow;

  const requested = searchParams.get("step");
  const remembered = modulesEnabled ? rememberedStage(projectId, activeModuleId) : null;
  const stage = workflow.isStage(requested)
    ? requested
    : workflow.isStage(remembered)
      ? remembered
      : workflow.firstStage;

  // This page remembers the stage each module shows, so reopening or
  // switching back lands there. Only while modules are on: until then the
  // project keeps opening at the first stage. Skipped while the URL still
  // names another module: that render belongs to a switch in flight.
  const moduleParam = searchParams.get("module");
  useEffect(() => {
    if (!modulesEnabled || moduleParam !== activeModuleId) return;
    rememberStage(projectId, activeModuleId, stage);
  }, [stage, modulesEnabled, moduleParam, activeModuleId, projectId]);

  // The address focuses a unit when the page opens on it, when an item is
  // opened where it is named, and when the browser goes back or forward.
  const [revealRequest, setRevealRequest] = useState(() => revealRequestOf(searchParams));
  useEffect(() => {
    const onPopState = () => setRevealRequest(revealRequestOf(new URL(window.location.href).searchParams));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigation = useMemo<WorkflowNavigation>(
    () => ({
      openUnit: (place, from) => {
        const search = searchParams.toString();
        if (from != null) window.history.replaceState(null, "", unitHref(pathname, search, { step: stage, unit: from }));
        // The page reveals the unit itself; Next's own scroll and focus would take the focus from it.
        router.push(unitHref(pathname, search, { ...(place.module == null ? {} : { module: place.module }), step: place.stage, unit: place.unitId }), { scroll: false });
        setRevealRequest({ unitId: place.unitId });
      },
      revealRequest,
      revealed: (request) => setRevealRequest((current) => (current === request ? null : current)),
    }),
    [searchParams, pathname, stage, router, revealRequest],
  );

  const view = useMemo(() => ({ module: store, workflow }), [store, workflow]);
  return (
    <workflowViewContext.Provider value={view}>
      <workflowNavigationContext.Provider value={navigation}>
        <Stack direction="row" sx={{ minHeight: 0, height: "100%", width: "100%", flexGrow: 1 }}>
          <StageNavigation
            selected={stage}
            onSelect={(next) => {
              setRevealRequest(null);
              router.push(stepHref(pathname, searchParams.toString(), next));
            }}
          />
          <Divider orientation="vertical" flexItem />
          <StageView key={stage} stage={stage} />
        </Stack>
      </workflowNavigationContext.Provider>
    </workflowViewContext.Provider>
  );
});

export default Factory;
