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
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ActionTooltip } from "actions/ActionHint";
import { redoAlternateShortcut, redoShortcut, stepsShortcut, undoShortcut } from "actions/actions";
import { labelOfName } from "agents";
import { useAgents } from "agents/ui";
import type { FocusPlace, ListedStep, ListedSteps, StepListTarget, StepPlace } from "history";
import { isEditableTarget, isOverlayTarget, type ShortcutBinding, useShortcut } from "hooks/shortcuts";
import { getUserFacingErrorMessage } from "lib/errors";
import { requestPlace } from "lib/placeRequests";
import { previewHref } from "lib/routes";
import { useProject } from "projectContext";

import DifferenceList, { DifferenceFromNowOverlay } from "./DifferenceList";
import { notify } from "./notices";

/** Run a history request; a refusal, such as while an outside change waits, says why. */
function attempt(request: () => Promise<unknown>, fallback: string): void {
  request().catch((error: unknown) => notify(getUserFacingErrorMessage(error, fallback), "error"));
}

/** Undo or redo, then show where it puts the focus. */
function move(request: () => Promise<FocusPlace | null>, fallback: string): void {
  attempt(async () => {
    const focus = await request();
    if (focus != null) requestPlace(focus);
  }, fallback);
}

const PLACE_LABELS: Partial<Record<StepPlace, string>> = {
  current: "Current",
  undone: "Undone",
  "other branch": "Other branch",
};

function kindLabel(kind: ListedStep["kind"]): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

/** Undo, Redo and the list of steps of the open project, with their keys outside text fields. */
export default function HistoryControls() {
  const { history, undo, redo } = useProject();
  const [panelOpen, setPanelOpen] = useState(false);
  const runUndo = useCallback(() => move(undo, "Could not undo."), [undo]);
  const runRedo = useCallback(() => move(redo, "Could not redo."), [redo]);

  const bindings = useMemo<ShortcutBinding[]>(() => {
    const when = (event: KeyboardEvent) => !isEditableTarget(event.target);
    return [
      { id: "undo", ...undoShortcut, when, action: runUndo },
      { id: "redo", ...redoShortcut, when, action: runRedo },
      { id: "redo-alternate", ...redoAlternateShortcut, when, action: runRedo },
      { id: "open-steps", ...stepsShortcut, when: (event) => when(event) && !isOverlayTarget(event.target), action: () => setPanelOpen(true) },
    ];
  }, [runUndo, runRedo]);
  useShortcut(bindings[0]!);
  useShortcut(bindings[1]!);
  useShortcut(bindings[2]!);
  useShortcut(bindings[3]!);

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
      <ActionTooltip name="Steps" shortcut={stepsShortcut}>
        <IconButton aria-label="Steps" onClick={() => setPanelOpen(true)}>
          <History />
        </IconButton>
      </ActionTooltip>
      <Drawer anchor="right" open={panelOpen} onClose={() => setPanelOpen(false)}>
        {panelOpen && <HistoryPanel onClose={() => setPanelOpen(false)} />}
      </Drawer>
    </>
  );
}

/**
 * Every kept step, newest first, with what it changed, then the start,
 * before the oldest of them; each one a way to look at the project as it
 * was there, and to go there.
 */
function HistoryPanel({ onClose }: { onClose: () => void }) {
  const { history, listSteps, modulesEnabled } = useProject();
  const agents = useAgents().view.agents;
  const [listed, setListed] = useState<ListedSteps | null>(null);
  const currentStep = history?.currentStep ?? null;

  // Listed again whenever the project moves in its history.
  useEffect(() => {
    let cancelled = false;
    listSteps().then(
      (steps) => {
        if (!cancelled) setListed(steps);
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
          Steps
        </Typography>
        <IconButton aria-label="Close" onClick={onClose}>
          <Close />
        </IconButton>
      </Stack>
      <Typography variant="body2" sx={{ px: 2, pb: 1, color: "text.secondary" }}>
        {listed != null && listed.start == null ? (
          "No changes yet."
        ) : (
          "Each step lists what it added (+), changed (~) or removed (−). Point at or focus “Go to” to see what going there would change. Faded steps did not lead to the project now."
        )}
      </Typography>
      <List dense disablePadding sx={{ overflowY: "auto", flexGrow: 1, "& > li + li": { borderTop: 1, borderColor: "divider" } }}>
        {(listed?.steps ?? []).map((step) => {
          const ledToNow = step.place === "current" || step.place === "done";
          return (
            <ListItem key={step.id} sx={{ display: "block", px: 2, opacity: ledToNow ? 1 : 0.6 }}>
              <ListedStateHead label={step.description ?? kindLabel(step.kind)} place={step.place} target={{ kind: "step", id: step.id }} onPreview={onClose} />
              <Typography variant="caption" sx={{ display: "block", color: "text.secondary" }}>
                {step.by.kind === "agent" ? labelOfName(agents, step.by.name) : "You"}, {new Date(step.at).toLocaleString()}
              </Typography>
              {step.change != null && <DifferenceList difference={step.change} withModules={modulesEnabled} reading="step" />}
            </ListItem>
          );
        })}
        {listed?.start != null && (
          <ListItem sx={{ display: "block", px: 2 }}>
            <ListedStateHead
              label="Before these steps"
              place={listed.start.current ? "current" : "done"}
              target={{ kind: "start", id: listed.start.id }}
              onPreview={onClose}
            />
          </ListItem>
        )}
      </List>
    </Stack>
  );
}

/** The head of a row of the list of steps: its name, where it stands, and ways to preview it, unless the project is there, and to go there. */
function ListedStateHead({ label, place, target, onPreview }: { label: string; place: StepPlace; target: StepListTarget; onPreview: () => void }) {
  const { goTo } = useProject();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const placeLabel = PLACE_LABELS[place];
  const preview = () => {
    onPreview();
    router.push(previewHref(pathname, searchParams.toString(), target), { scroll: false });
  };
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
      <Typography variant="body2">{label}</Typography>
      {placeLabel != null && (
        <Chip size="small" label={placeLabel} color={place === "current" ? "primary" : "default"} variant={place === "current" ? "filled" : "outlined"} />
      )}
      <Box sx={{ flexGrow: 1 }} />
      {place !== "current" && (
        <Button size="small" onClick={preview}>
          Preview
        </Button>
      )}
      <DifferenceFromNowOverlay target={target}>
        <Button size="small" onClick={() => attempt(() => goTo(target), "Could not go to it.")}>
          Go to
        </Button>
      </DifferenceFromNowOverlay>
    </Box>
  );
}
