"use client";

import { Box, Button, Paper, Typography } from "@mui/material";
import type { ReactElement, ReactNode } from "react";

/**
 * An offer to go to each unit of the set an agent pointed the spec owner
 * to, in turn, with the one text the agent gave. It stays until the spec
 * owner dismisses it, whatever they do meanwhile, and never takes the focus.
 */
export default function PointerOffer({
  text,
  from,
  units,
  index,
  onGo,
  onDismiss,
  goButton,
  dismissButton,
}: {
  text: string;
  /** The agent's name. */
  from: string;
  /** Each unit, as the spec owner reads where it is, such as "REQ-04, Requirements". */
  units: readonly string[];
  /** The unit going goes to now; going moves on to the next. */
  index: number;
  onGo: () => void;
  onDismiss: () => void;
  /** Wraps each button, such as with a hint naming its shortcut. */
  goButton?: (button: ReactElement) => ReactNode;
  dismissButton?: (button: ReactElement) => ReactNode;
}) {
  const go = (
    <Button size="small" variant="contained" onClick={onGo}>
      Go to it
    </Button>
  );
  const dismiss = (
    <Button size="small" onClick={onDismiss}>
      Dismiss
    </Button>
  );
  return (
    <Paper elevation={4} sx={{ p: 1.5 }}>
      <Typography variant="body2">{text}</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", "&::first-letter": { textTransform: "uppercase" } }}>
        {units[index]}
        {units.length > 1 ? ` (${index + 1} of ${units.length})` : ""} · {from}
      </Typography>
      <Box sx={{ display: "flex", gap: 1, mt: 1 }}>
        {goButton == null ? go : goButton(go)}
        {dismissButton == null ? dismiss : dismissButton(dismiss)}
      </Box>
    </Paper>
  );
}
