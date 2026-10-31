"use client";

import { Divider, Stack } from "@mui/material";
import { observer } from "mobx-react-lite";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo } from "react";

import { stepHref } from "lib/routes";
import { useProject } from "projectContext";
import { useStore } from "store";
import { StageNavigation, StageView, workflowViewContext } from "workflow/ui";

/** The open module: its stages beside the one the page shows. */
const Factory = observer(function Factory() {
  const store = useStore();
  const { modulesEnabled, activeModuleId, activeModuleOpenStep, recordOpenStep } = useProject();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const workflow = store.workflow;

  const requested = searchParams.get("step");
  const stage = workflow.isStage(requested)
    ? requested
    : modulesEnabled && workflow.isStage(activeModuleOpenStep)
      ? activeModuleOpenStep
      : workflow.firstStage;

  // The active module remembers the stage it shows, so reopening or
  // switching back lands there. Skipped while the URL still names another
  // module: that render belongs to a switch in flight.
  const moduleParam = searchParams.get("module");
  useEffect(() => {
    if (modulesEnabled && moduleParam !== activeModuleId) return;
    if (stage === activeModuleOpenStep) return;
    void recordOpenStep(stage);
  }, [stage, activeModuleOpenStep, modulesEnabled, moduleParam, activeModuleId, recordOpenStep]);

  const view = useMemo(() => ({ module: store, workflow }), [store, workflow]);
  return (
    <workflowViewContext.Provider value={view}>
      <Stack direction="row" sx={{ minHeight: 0, height: "100%", width: "100%", flexGrow: 1 }}>
        <StageNavigation
          selected={stage}
          onSelect={(next) => router.push(stepHref(pathname, searchParams.toString(), next))}
        />
        <Divider orientation="vertical" flexItem />
        <StageView key={stage} stage={stage} />
      </Stack>
    </workflowViewContext.Provider>
  );
});

export default Factory;
