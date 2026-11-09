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
    <Stack spacing={1} sx={{ p: 1.5, minHeight: 0, height: form === "overlay" ? undefined : "100%" }}>
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
      <Stack sx={{ overflowY: "auto", minHeight: 0, maxHeight: form === "overlay" ? "60vh" : undefined }}>
        <ThreadPanel key={unitId} unitId={unitId} threads={module.threadsOf(unitId)} stageOpen={stageOpen} autoFocus={autoFocus} onClose={onClose} />
      </Stack>
    </Stack>
  );
  const closeOnEscape = (content: ReactNode) => (
    <Stack
      sx={{ minHeight: 0, height: "100%" }}
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
  return (
    <Popper open={anchor != null} anchorEl={anchor} placement="bottom-start" sx={{ zIndex: (theme) => theme.zIndex.modal }}>
      <ClickAwayListener
        onClickAway={(event) => {
          if (event.target instanceof Element && event.target.closest(`[${THREAD_BUTTON}]`) != null) return;
          onClose();
        }}
      >
        <Paper elevation={8} sx={{ width: 480, maxWidth: "calc(100vw - 32px)" }}>{closeOnEscape(body)}</Paper>
      </ClickAwayListener>
    </Popper>
  );
});

export default ThreadView;
