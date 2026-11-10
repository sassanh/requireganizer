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
  ListItemText,
  Stack,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ActionTooltip } from "actions/ActionHint";
import { redoAlternateShortcut, redoShortcut, undoShortcut } from "actions/actions";
import { isEditableTarget, type ShortcutBinding, useShortcut } from "hooks/shortcuts";
import { getUserFacingErrorMessage } from "lib/errors";
import { useProject } from "projectContext";
import type { ListedStep, StepPlace } from "storage-and-recovery";

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
  const { history, listSteps, bringBackStep } = useProject();
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
    <Stack sx={{ width: { xs: "100vw", sm: 380 }, height: "100%" }}>
      <Stack direction="row" sx={{ alignItems: "center", px: 2, py: 1 }}>
        <Typography variant="h6" sx={{ flexGrow: 1 }}>
          History
        </Typography>
        <IconButton aria-label="Close" onClick={onClose}>
          <Close />
        </IconButton>
      </Stack>
      {steps != null && steps.length === 0 && (
        <Typography sx={{ px: 2, color: "text.secondary" }}>No changes yet.</Typography>
      )}
      <List dense sx={{ overflowY: "auto", flexGrow: 1 }}>
        {(steps ?? []).map((step) => {
          const placeLabel = PLACE_LABELS[step.place];
          return (
            <ListItem
              key={step.id}
              secondaryAction={
                step.place === "current" ? null : (
                  <Button size="small" onClick={() => attempt(() => bringBackStep(step.id), "Could not bring it back.")}>
                    Bring back
                  </Button>
                )
              }
            >
              <ListItemText
                primary={
                  <Box component="span" sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    {kindLabel(step.kind)}
                    {placeLabel != null && (
                      <Chip
                        size="small"
                        label={placeLabel}
                        color={step.place === "current" ? "primary" : "default"}
                        variant={step.place === "current" ? "filled" : "outlined"}
                      />
                    )}
                  </Box>
                }
                secondary={new Date(step.at).toLocaleString()}
              />
            </ListItem>
          );
        })}
      </List>
    </Stack>
  );
}
