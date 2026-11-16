"use client";

import { Close, KeyboardArrowDown, KeyboardArrowUp } from "@mui/icons-material";
import { Button, Chip, IconButton, Stack } from "@mui/material";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

import { ActionTooltip } from "actions/ActionHint";
import { closePreviewShortcut, nextMarkShortcut, previousMarkShortcut } from "actions/actions";
import type { FocusPlace, PreviewTarget } from "history";
import { isEditableTarget, isOverlayTarget, type ShortcutBinding, useShortcut } from "hooks/shortcuts";
import { getUserFacingErrorMessage } from "lib/errors";
import { requestPlace, shownFocus } from "lib/placeRequests";
import { previewHref } from "lib/routes";
import { useProject } from "projectContext";
import { adjacentMark, previewMarksOf, shownWithRemoved, threadMarkPosition } from "screens/previewMarks";

import { DifferenceFromNowOverlay } from "./DifferenceList";
import { notify } from "./notices";

const PREVIEW_LABELS: Record<PreviewTarget["kind"], string> = {
  step: "Preview after a step, read only",
  start: "Preview before these steps, read only",
  "restore point": "Preview of a restore point, read only",
};

/**
 * While an earlier state is previewed: which state the page shows, how many
 * marks it has, and ways to move between them, to go to the step or
 * restore the restore point, and to close the preview, by keyboard as well as by pointer.
 */
export default function PreviewControls() {
  const { preview, modules, moduleStore, closePreview, goTo, restoreToRestorePoint } = useProject();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const close = useCallback(() => {
    router.push(previewHref(pathname, window.location.search, null), { scroll: false });
  }, [router, pathname]);

  const moveToMark = useCallback(
    (direction: 1 | -1) => {
      if (preview == null) return;
      const rankOf = (moduleId: string) => {
        const index = modules.findIndex(({ id }) => id === moduleId);
        return index === -1 ? modules.length : index;
      };
      // Each mark and the focus by where the preview shows it: one stage's units, with those it would remove, then its threads on removed units.
      const stageOrders = new Map<string, { units: string[]; threads: string[] }>();
      const stageOrder = (moduleId: string, stage: string) => {
        const key = `${moduleId} ${stage}`;
        let order = stageOrders.get(key);
        if (order == null) {
          const marks = previewMarksOf(preview.difference, moduleId);
          const shown = moduleStore(moduleId)?.unitsInShownOrder(stage).map(({ unitId }) => unitId) ?? [];
          order = { units: shownWithRemoved(shown, marks.removed(stage)), threads: marks.threads(stage).map(({ unitId }) => unitId) };
          stageOrders.set(key, order);
        }
        return order;
      };
      const positionOf = (place: FocusPlace) => {
        if (place.unitId == null) return -1;
        const { units, threads } = stageOrder(place.moduleId, place.stage);
        const position = units.indexOf(place.unitId);
        if (position !== -1) return position;
        const thread = threads.indexOf(place.unitId);
        return thread === -1 ? -1 : threadMarkPosition(thread);
      };
      const mark = adjacentMark(preview.difference, shownFocus(), direction, rankOf, positionOf);
      if (mark != null) requestPlace({ moduleId: mark.moduleId, stage: mark.stage, unitId: mark.unitId });
    },
    [preview, modules, moduleStore],
  );

  const bindings = useMemo<ShortcutBinding[]>(() => {
    const when = (event: KeyboardEvent) => !isEditableTarget(event.target) && !isOverlayTarget(event.target);
    return [
      { id: "next-mark", ...nextMarkShortcut, when, action: () => moveToMark(1) },
      { id: "previous-mark", ...previousMarkShortcut, when, action: () => moveToMark(-1) },
      { id: "close-preview", ...closePreviewShortcut, when, action: close },
    ];
  }, [moveToMark, close]);
  useShortcut(bindings[0]!);
  useShortcut(bindings[1]!);
  useShortcut(bindings[2]!);

  if (preview == null) return null;
  const { target, difference } = preview;
  const bringBack = () => {
    closePreview();
    router.push(previewHref(pathname, searchParams.toString(), null), { scroll: false });
    const request = target.kind === "restore point" ? restoreToRestorePoint(target.id) : goTo(target);
    request.catch((error: unknown) =>
      notify(getUserFacingErrorMessage(error, target.kind === "restore point" ? "Could not restore it." : "Could not go to it."), "error"),
    );
  };
  const marks = difference.units.length + difference.threads.length;
  const markCount = difference.same ? "Same as now" : marks === 0 ? "Differs from now only in its modules" : `${marks} ${marks === 1 ? "difference" : "differences"}`;
  return (
    <Stack direction="row" sx={{ alignItems: "center", gap: 1, flexShrink: 0 }}>
      <Chip color="warning" label={PREVIEW_LABELS[target.kind]} />
      <DifferenceFromNowOverlay target={target}>
        <Chip variant="outlined" label={markCount} tabIndex={0} />
      </DifferenceFromNowOverlay>
      <ActionTooltip name="Previous difference" shortcut={previousMarkShortcut}>
        <span>
          <IconButton aria-label="Previous difference" disabled={marks === 0} onClick={() => moveToMark(-1)}>
            <KeyboardArrowUp />
          </IconButton>
        </span>
      </ActionTooltip>
      <ActionTooltip name="Next difference" shortcut={nextMarkShortcut}>
        <span>
          <IconButton aria-label="Next difference" disabled={marks === 0} onClick={() => moveToMark(1)}>
            <KeyboardArrowDown />
          </IconButton>
        </span>
      </ActionTooltip>
      <Button size="small" variant="contained" color="warning" onClick={bringBack}>
        {target.kind === "restore point" ? "Restore" : "Go to"}
      </Button>
      <ActionTooltip name="Close the preview" shortcut={closePreviewShortcut}>
        <IconButton aria-label="Close the preview" onClick={close}>
          <Close />
        </IconButton>
      </ActionTooltip>
    </Stack>
  );
}
