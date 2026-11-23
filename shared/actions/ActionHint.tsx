import { Box, Tooltip } from "@mui/material";
import { type ReactElement } from "react";

import {
  shortcutText,
  shortcutWords,
  type ShortcutSpec,
} from "./shortcutText";

/** Screen-reader-only text: the spelled-out keys behind the glyphs. */
const hiddenText = {
  position: "absolute",
  width: "1px",
  height: "1px",
  padding: 0,
  margin: "-1px",
  overflow: "hidden",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
  border: 0,
} as const;

/**
 * The shortcut half of a row: muted glyphs for sighted users, the same
 * keys spelled out for assistive technology. Shared by hover hints and
 * menu rows so both read the same way.
 */
export function ShortcutLabel({ shortcut }: { shortcut: ShortcutSpec }) {
  return (
    <Box
      component="span"
      sx={{
        opacity: 0.6,
        whiteSpace: "nowrap",
        letterSpacing: "0.02em",
      }}
    >
      <Box component="span" aria-hidden="true">
        {shortcutText(shortcut)}
      </Box>
      <Box component="span" sx={hiddenText}>
        {shortcutWords(shortcut)}
      </Box>
    </Box>
  );
}

/**
 * Hover hint for an action: name on the left, its shortcut as muted glyphs
 * on the right. No parentheses — the spacing carries the relationship.
 */
export function ActionHint({
  name,
  shortcut,
}: {
  name: string;
  shortcut?: ShortcutSpec;
}) {
  if (shortcut == null) return <>{name}</>;
  return (
    <Box
      component="span"
      sx={{ display: "flex", alignItems: "baseline", gap: 3 }}
    >
      <Box component="span">{name}</Box>
      <ShortcutLabel shortcut={shortcut} />
    </Box>
  );
}

/**
 * Action tooltip: name plus its shortcut, with the surface supplied by the
 * shared MuiTooltip theme override so every tooltip in the app matches.
 */
export function ActionTooltip({
  name,
  shortcut,
  children,
}: {
  name: string;
  shortcut?: ShortcutSpec;
  children: ReactElement;
}) {
  return (
    <Tooltip title={<ActionHint name={name} shortcut={shortcut} />}>
      {children}
    </Tooltip>
  );
}
