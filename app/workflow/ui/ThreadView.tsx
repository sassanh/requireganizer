"use client";

import { Close, ViewSidebar } from "@mui/icons-material";
import { ClickAwayListener, Dialog, IconButton, Paper, Popper, Stack, Tooltip, Typography } from "@mui/material";
import { observer } from "mobx-react-lite";
import { useState, type ReactNode } from "react";

import { useWorkflowView } from "./context";
import ThreadPanel from "./ThreadPanel";

/** How an opened thread shows: over the stage beside its card, docked at the right edge, or over the whole screen. */
export type ThreadForm = "overlay" | "docked" | "full";

const FORM_KEY = "requireganizer.threadForm";

/** Whether threads open docked, remembered in this browser until the dock is closed. */
export function useThreadForm(): [Exclude<ThreadForm, "full">, (form: Exclude<ThreadForm, "full">) => void] {
  const [form, setForm] = useState<Exclude<ThreadForm, "full">>(() => {
    try {
      return window.localStorage.getItem(FORM_KEY) === "docked" ? "docked" : "overlay";
    } catch {
      return "overlay";
    }
  });
  const choose = (next: Exclude<ThreadForm, "full">) => {
    setForm(next);
    try {
      window.localStorage.setItem(FORM_KEY, next);
    } catch {
      // The choice then lasts only while the page is open.
    }
  };
  return [form, choose];
}

/** Space kept between the overlay and the window's edge, and the least height worth opening below the card. */
const OVERLAY_MARGIN = 16;
const OVERLAY_MIN_HEIGHT = 360;

/** A clicked thread button opens its own thread, so a click on one never counts as a click away. */
export const THREAD_BUTTON = "data-thread-button";

/**
 * One unit's threads, opened from its card: their messages, the reply or
 * change request box, and controls to dock the overlay and to close. The
 * docked form is the page's side panel.
 */
const ThreadView = observer(function ThreadView({
  unitId,
  form,
  anchor,
  stageOpen,
  autoFocus,
  onDock,
  onClose,
}: {
  unitId: string;
  form: ThreadForm;
  /** Where the overlay shows: the card's actions. */
  anchor: HTMLElement | null;
  stageOpen: boolean;
  autoFocus: boolean;
  onDock: () => void;
  /** Closes the thread; closing the docked form also undocks, so the next thread opens beside its card. */
  onClose: () => void;
}) {
  const { module } = useWorkflowView();
  const body = (
    <Stack spacing={1} sx={{ p: 1.5, minHeight: 0, height: form === "overlay" ? undefined : "100%", maxHeight: "inherit" }}>
      <Stack direction="row" sx={{ alignItems: "center", gap: 0.5 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, flexGrow: 1 }}>Thread on {module.unitLabel(unitId)}</Typography>
        {form === "overlay" && (
          <Tooltip title="Dock at the right">
            <IconButton size="small" onClick={onDock}><ViewSidebar fontSize="small" /></IconButton>
          </Tooltip>
        )}
        <Tooltip title="Close (Esc)">
          <IconButton size="small" onClick={onClose}><Close fontSize="small" /></IconButton>
        </Tooltip>
      </Stack>
      <ThreadPanel key={unitId} unitId={unitId} threads={module.threadsOf(unitId)} stageOpen={stageOpen} autoFocus={autoFocus} onClose={onClose} />
    </Stack>
  );
  const closeOnEscape = (content: ReactNode) => (
    <Stack
      sx={{ minHeight: 0, height: "100%", maxHeight: "inherit" }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        onClose();
      }}
    >
      {content}
    </Stack>
  );

  if (form === "full") {
    return <Dialog open fullScreen onClose={onClose}>{body}</Dialog>;
  }
  if (form === "docked") {
    return (
      <Paper square variant="outlined" sx={{ width: 420, flexShrink: 0, borderTop: 0, borderBottom: 0, borderRight: 0, minHeight: 0 }}>
        {closeOnEscape(body)}
      </Paper>
    );
  }
  // The overlay opens below the card's actions, or above them when too little of the window is left below, and never runs past the window.
  const anchorBox = anchor?.getBoundingClientRect() ?? null;
  const below = anchorBox == null ? 0 : window.innerHeight - anchorBox.bottom - OVERLAY_MARGIN;
  const above = anchorBox == null ? 0 : anchorBox.top - OVERLAY_MARGIN;
  const opensAbove = below < OVERLAY_MIN_HEIGHT && above > below;
  return (
    <Popper open={anchor != null} anchorEl={anchor} placement={opensAbove ? "top-start" : "bottom-start"} sx={{ zIndex: (theme) => theme.zIndex.modal }}>
      <ClickAwayListener
        onClickAway={(event) => {
          if (event.target instanceof Element && event.target.closest(`[${THREAD_BUTTON}]`) != null) return;
          onClose();
        }}
      >
        <Paper elevation={8} sx={{ width: 480, maxWidth: "calc(100vw - 32px)", maxHeight: Math.min(window.innerHeight * 0.7, opensAbove ? above : below), display: "flex", flexDirection: "column" }}>
          {closeOnEscape(body)}
        </Paper>
      </ClickAwayListener>
    </Popper>
  );
});

export default ThreadView;
