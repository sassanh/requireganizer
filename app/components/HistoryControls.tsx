"use client";

import { Close, History, Redo, Undo } from "@mui/icons-material";
import {
  Box,
  Button,
  Chip,
  Drawer,
  IconButton,
  List,
  ListItem,
  Stack,
  Typography,
} from "@mui/material";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

import { ActionTooltip } from "actions/ActionHint";
import { redoAlternateShortcut, redoShortcut, undoShortcut } from "actions/actions";
import { isEditableTarget, type ShortcutBinding, useShortcut } from "hooks/shortcuts";
import { getUserFacingErrorMessage } from "lib/errors";
import { useProject } from "projectContext";
import type { ListedStep, StageDifference, StepPlace } from "storage-and-recovery";

import { notify } from "./notices";

/** Run a history request; a refusal, such as while an outside change waits, says why. */
function attempt(request: () => Promise<void>, fallback: string): void {
  request().catch((error: unknown) => notify(getUserFacingErrorMessage(error, fallback), "error"));
}

const PLACE_LABELS: Partial<Record<StepPlace, string>> = {
  current: "Current",
  undone: "Undone",
  "other branch": "Other branch",
};

function kindLabel(kind: ListedStep["kind"]): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

/** One part of a stage's difference: what the step's project holds more of, less of, or holds changed, with the items' codes where it counts items. */
interface DifferencePart {
  text: string;
  color: "success.main" | "error.main" | "warning.main";
  codes: readonly string[];
}

function partsOf(difference: StageDifference): DifferencePart[] {
  const part = (count: number, text: string, color: DifferencePart["color"], codes: readonly string[] = []): DifferencePart[] =>
    count > 0 ? [{ text, color, codes }] : [];
  const more = (count: number, one: string, many: string, codes?: readonly string[]) =>
    part(count, `+${count} ${count === 1 ? one : many}`, "success.main", codes);
  const fewer = (count: number, one: string, many: string, codes?: readonly string[]) =>
    part(count, `−${count} ${count === 1 ? one : many}`, "error.main", codes);
  const { itemsMore, itemsFewer, itemsChanged } = difference;
  return [
    ...more(itemsMore.length, "item", "items", itemsMore),
    ...fewer(itemsFewer.length, "item", "items", itemsFewer),
    ...part(itemsChanged.length, `${itemsChanged.length} changed`, "warning.main", itemsChanged),
    ...more(difference.signaturesMore, "signature", "signatures"),
    ...fewer(difference.signaturesFewer, "signature", "signatures"),
    ...more(difference.messagesMore, "message", "messages"),
    ...fewer(difference.messagesFewer, "message", "messages"),
  ];
}

/** How the project after a step differs from the project now: each stage that differs with its counts, under its module where the project has several. */
function StepDifference({ step, withModules }: { step: ListedStep; withModules: boolean }) {
  const { difference } = step;
  if (difference == null || step.place === "current") return null;
  if (difference.stages.length === 0) {
    return (
      <Typography variant="caption" sx={{ color: "text.secondary" }}>
        {difference.same ? "Same as now" : "Differs from now in order, threads or modules"}
      </Typography>
    );
  }
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "auto 1fr", columnGap: 1.5, rowGap: 0.25, mt: 0.5, pl: 1, borderLeft: 2, borderColor: "divider" }}>
      {difference.stages.map((stage, index) => (
        <Fragment key={`${stage.module} ${stage.stage}`}>
          {withModules && stage.module !== difference.stages[index - 1]?.module && (
            <Typography variant="caption" sx={{ gridColumn: "1 / -1", color: "text.secondary", fontWeight: 600 }}>
              {stage.module}
            </Typography>
          )}
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            {stage.stage}
          </Typography>
          <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 1, rowGap: 0.25 }}>
            {partsOf(stage).map(({ text, color, codes }) => (
              <Fragment key={text}>
                <Typography variant="caption" sx={{ color, whiteSpace: "nowrap" }}>
                  {text}
                </Typography>
                {codes.map((code) => (
                  <Chip key={code} size="small" variant="outlined" label={code} sx={{ height: 18, fontSize: "0.7rem" }} />
                ))}
              </Fragment>
            ))}
          </Box>
        </Fragment>
      ))}
    </Box>
  );
}

/** Undo, Redo and the History panel of the open project, with their keys outside text fields. */
export default function HistoryControls() {
  const { history, undo, redo } = useProject();
  const [panelOpen, setPanelOpen] = useState(false);
  const runUndo = useCallback(() => attempt(undo, "Could not undo."), [undo]);
  const runRedo = useCallback(() => attempt(redo, "Could not redo."), [redo]);

  const bindings = useMemo<ShortcutBinding[]>(() => {
    const when = (event: KeyboardEvent) => !isEditableTarget(event.target);
    return [
      { id: "undo", ...undoShortcut, when, action: runUndo },
      { id: "redo", ...redoShortcut, when, action: runRedo },
      { id: "redo-alternate", ...redoAlternateShortcut, when, action: runRedo },
    ];
  }, [runUndo, runRedo]);
  useShortcut(bindings[0]!);
  useShortcut(bindings[1]!);
  useShortcut(bindings[2]!);

  return (
    <>
      <ActionTooltip name="Undo" shortcut={undoShortcut}>
        <span>
          <IconButton aria-label="Undo" disabled={!history?.canUndo} onClick={runUndo}>
            <Undo />
          </IconButton>
        </span>
      </ActionTooltip>
      <ActionTooltip name="Redo" shortcut={redoShortcut}>
        <span>
          <IconButton aria-label="Redo" disabled={!history?.canRedo} onClick={runRedo}>
            <Redo />
          </IconButton>
        </span>
      </ActionTooltip>
      <ActionTooltip name="History">
        <IconButton aria-label="History" onClick={() => setPanelOpen(true)}>
          <History />
        </IconButton>
      </ActionTooltip>
      <Drawer anchor="right" open={panelOpen} onClose={() => setPanelOpen(false)}>
        {panelOpen && <HistoryPanel onClose={() => setPanelOpen(false)} />}
      </Drawer>
    </>
  );
}

/** Every kept step, newest first, each one a way back to the project as it was after it. */
function HistoryPanel({ onClose }: { onClose: () => void }) {
  const { history, listSteps, bringBackStep, modulesEnabled } = useProject();
  const [steps, setSteps] = useState<ListedStep[] | null>(null);
  const currentStep = history?.currentStep ?? null;

  // Listed again whenever the project moves in its history.
  useEffect(() => {
    let cancelled = false;
    listSteps().then(
      (listed) => {
        if (!cancelled) setSteps(listed);
      },
      (error: unknown) => notify(getUserFacingErrorMessage(error, "Could not list the history."), "error"),
    );
    return () => {
      cancelled = true;
    };
  }, [listSteps, currentStep]);

  return (
    <Stack sx={{ width: { xs: "100vw", sm: 420 }, height: "100%" }}>
      <Stack direction="row" sx={{ alignItems: "center", px: 2, py: 1 }}>
        <Typography variant="h6" sx={{ flexGrow: 1 }}>
          History
        </Typography>
        <IconButton aria-label="Close" onClick={onClose}>
          <Close />
        </IconButton>
      </Stack>
      <Typography variant="body2" sx={{ px: 2, pb: 1, color: "text.secondary" }}>
        {steps != null && steps.length === 0 ? "No changes yet." : "Each step shows what the project held after it, compared with now."}
      </Typography>
      <List dense disablePadding sx={{ overflowY: "auto", flexGrow: 1, "& > li + li": { borderTop: 1, borderColor: "divider" } }}>
        {(steps ?? []).map((step) => {
          const placeLabel = PLACE_LABELS[step.place];
          return (
            <ListItem key={step.id} sx={{ display: "block", px: 2 }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Typography variant="body2">{kindLabel(step.kind)}</Typography>
                {placeLabel != null && (
                  <Chip
                    size="small"
                    label={placeLabel}
                    color={step.place === "current" ? "primary" : "default"}
                    variant={step.place === "current" ? "filled" : "outlined"}
                  />
                )}
                <Box sx={{ flexGrow: 1 }} />
                {step.place !== "current" && (
                  <Button size="small" onClick={() => attempt(() => bringBackStep(step.id), "Could not bring it back.")}>
                    Bring back
                  </Button>
                )}
              </Box>
              <Typography variant="caption" sx={{ display: "block", color: "text.secondary" }}>
                {new Date(step.at).toLocaleString()}
              </Typography>
              <StepDifference step={step} withModules={modulesEnabled} />
            </ListItem>
          );
        })}
      </List>
    </Stack>
  );
}
