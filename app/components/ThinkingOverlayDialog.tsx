"use client";

import { Psychology } from "@mui/icons-material";
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
} from "@mui/material";
import { observer } from "mobx-react-lite";
import { useEffect, useRef } from "react";

import { useStore } from "store";

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function ThinkingOverlayDialog() {
  const store = useStore();
  const label = store.thinkingLabel;
  const text = store.thinkingText;
  const contentRef = useRef<HTMLDivElement | null>(null);
  const open = label != null;

  useEffect(() => {
    const content = contentRef.current;
    if (open && content != null) {
      content.scrollTop = content.scrollHeight;
    }
  }, [open, text]);

  if (!open) return null;

  return (
    <Dialog
      open={open}
      onClose={store.abortAiOperation}
      fullWidth
      maxWidth="sm"
      slotProps={{ paper: { sx: { minHeight: "40vh" } } }}
    >
      <DialogTitle component="div">
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <Psychology color="primary" />
          <Box sx={{ flexGrow: 1 }}>{capitalize(label)}</Box>
          <CircularProgress size={18} disableShrink />
        </Box>
      </DialogTitle>
      <DialogContent
        dividers
        ref={contentRef}
        sx={{
          whiteSpace: "pre-wrap",
          typography: "body2",
          fontFamily: "monospace",
          color: "text.secondary",
        }}
      >
        {text.length === 0 ? "Thinking…" : text}
      </DialogContent>
      <DialogActions>
        <Button onClick={store.abortAiOperation}>Stop</Button>
      </DialogActions>
    </Dialog>
  );
}

export default observer(ThinkingOverlayDialog);
