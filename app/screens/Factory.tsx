"use client";

import { Divider, Stack } from "@mui/material";
import { observer } from "mobx-react-lite";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { noteShownFocus, subscribePlaceRequests } from "lib/placeRequests";
import { stepHref, unitHref } from "lib/routes";
import { rememberedStage, rememberStage } from "lib/viewState";
import { useProject } from "projectContext";
import { useStore } from "store";
import { currentEntryKey, currentOpener, ItemPreviewProvider, type RevealRequest, recordOpener, returnToOpener, StageNavigation, StageView, subscribeToEntries, type WorkflowNavigation, workflowNavigationContext, workflowViewContext } from "workflow/ui";

import { previewMarksOf } from "./previewMarks";

/** The unit or thread message an address focuses, to reveal once it shows. */
function revealRequestOf(search: URLSearchParams): RevealRequest | null {
  const unitId = search.get("unit");
  if (unitId == null) return null;
  const threadId = search.get("thread");
  const index = Number(search.get("message") ?? Number.NaN);
  return { unitId, message: threadId == null || !Number.isInteger(index) ? null : { threadId, index } };
}

/** The open module: its stages beside the one the page shows. */
const Factory = observer(function Factory() {
  const store = useStore();
  const { activeProject, modulesEnabled, activeModuleId, preview, reportFocus, withFocusMove } = useProject();
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

  // A place asked for from elsewhere on the page, such as after undo, shows in its module and stage, focused.
  const [stageFocusRequest, setStageFocusRequest] = useState<object | null>(null);
  useEffect(
    () =>
      subscribePlaceRequests(({ place, leavePreview }) => {
        const query = new URLSearchParams(window.location.search);
        if (leavePreview) query.delete("preview");
        if (modulesEnabled) query.set("module", place.moduleId);
        if (place.unitId == null) {
          router.push(stepHref(pathname, query.toString(), place.stage), { scroll: false });
          setRevealRequest(null);
          setStageFocusRequest({});
        } else {
          router.push(unitHref(pathname, query.toString(), { step: place.stage, unit: place.unitId }), { scroll: false });
          setRevealRequest({ unitId: place.unitId, message: null });
        }
      }),
    [modulesEnabled, pathname, router],
  );

  // Where the focus is, told to the project once each time it moves.
  const reported = useRef<string | null>(null);
  const focused = useMemo(
    () => (unitId: string | null) => {
      const place = { moduleId: activeModuleId, stage, unitId };
      noteShownFocus(place);
      const key = JSON.stringify(place);
      if (key === reported.current) return;
      reported.current = key;
      reportFocus(place);
    },
    [activeModuleId, stage, reportFocus],
  );

  // The entry shown, so the way back to where it was opened from follows the browser's history.
  const entryKey = useSyncExternalStore(subscribeToEntries, currentEntryKey, () => null);
  const opener = useMemo(() => (entryKey == null ? null : currentOpener()), [entryKey]);

  const navigation = useMemo<WorkflowNavigation>(
    () => ({
      openUnit: (place, from) => {
        const search = searchParams.toString();
        if (from != null) window.history.replaceState(null, "", unitHref(pathname, search, { step: stage, unit: from.unitId, message: from.message }));
        recordOpener(from);
        // The page reveals the unit itself; Next's own scroll and focus would take the focus from it.
        router.push(unitHref(pathname, search, { ...(place.module == null ? {} : { module: place.module }), step: place.stage, unit: place.unitId }), { scroll: false });
        setRevealRequest({ unitId: place.unitId, message: null });
      },
      opener: opener == null ? null : { place: opener.place },
      returnToOpener,
      revealRequest,
      revealed: (request) => setRevealRequest((current) => (current === request ? null : current)),
      stageFocusRequest,
      stageFocused: (request) => setStageFocusRequest((current) => (current === request ? null : current)),
      focused,
      withFocusMove,
    }),
    [searchParams, pathname, stage, router, revealRequest, opener, stageFocusRequest, focused, withFocusMove],
  );

  const previewMarks = useMemo(() => (preview == null ? null : previewMarksOf(preview.difference, activeModuleId)), [preview, activeModuleId]);
  const view = useMemo(() => ({ module: store, workflow, preview: previewMarks }), [store, workflow, previewMarks]);
  return (
    <workflowViewContext.Provider value={view}>
      <workflowNavigationContext.Provider value={navigation}>
        <ItemPreviewProvider>
        <Stack direction="row" sx={{ minHeight: 0, height: "100%", width: "100%", flexGrow: 1 }}>
          <StageNavigation
            selected={stage}
            onSelect={(next) => {
              setRevealRequest(null);
              router.push(stepHref(pathname, searchParams.toString(), next));
            }}
          />
          <Divider orientation="vertical" flexItem />
          {/* A stage mounts afresh for each module and earlier state it shows, so it shows as a stage opens: the cards near the screen first. */}
          <StageView key={`${stage} ${activeModuleId} ${preview == null ? "now" : `${preview.target.kind} ${preview.target.id}`}`} stage={stage} />
        </Stack>
        </ItemPreviewProvider>
      </workflowNavigationContext.Provider>
    </workflowViewContext.Provider>
  );
});

export default Factory;
