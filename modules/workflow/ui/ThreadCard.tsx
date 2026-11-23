"use client";

import { Box, Paper, Stack, Typography } from "@mui/material";
import { observer } from "mobx-react-lite";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";

import type { Thread } from "../threads";
import { threadPlace } from "../units";
import { type ThreadMark } from "./context";
import { useAuthorLabel } from "./slots";
import ThreadOwner from "./ThreadOwner";
import { THREAD_BUTTON } from "./ThreadView";
import WrittenText from "./WrittenText";

/** The grid thread cards show in, as many columns as fit. */
export const THREAD_GRID = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 1.5, alignItems: "stretch" } as const;

/** What bringing a previewed state back would do to a thread on a unit neither state holds. */
export function ThreadMarkNote({ mark }: { mark: ThreadMark | null }) {
  if (mark == null) return null;
  const quoted = (texts: readonly string[]) => texts.map((text) => `“${text.length > 80 ? `${text.slice(0, 80)}…` : text}”`).join(", ");
  return (
    <Stack sx={{ mt: 0.5, gap: 0.25 }}>
      {mark.onlyNow && <Typography variant="caption" sx={{ color: "error.main" }}>Bringing this back would remove this thread.</Typography>}
      {!mark.onlyNow && mark.messagesAdded.length > 0 && (
        <Typography variant="caption" sx={{ color: "success.main" }}>Would add: {quoted(mark.messagesAdded)}</Typography>
      )}
      {!mark.onlyNow && mark.messagesRemoved.length > 0 && (
        <Typography variant="caption" sx={{ color: "error.main" }}>Would remove: {quoted(mark.messagesRemoved)}</Typography>
      )}
      {mark.resolutionDiffers && <Typography variant="caption" sx={{ color: "warning.main" }}>Would change whether it is resolved.</Typography>}
    </Stack>
  );
}

/**
 * A resolved thread of the module the view shows, on the stage itself or on
 * a unit, as a card: what it is on, when it was resolved, its first message
 * and who wrote in it last. Shown in its own stage, with `onOpen`, the card
 * opens it there, and a thread on the stage itself is on "the stage";
 * elsewhere what it is on is the way there. A footer, when given, shows
 * under it. Nothing shows for an open thread, which its row shows.
 */
const ThreadCard = observer(function ThreadCard({
  thread: shown,
  moduleName = null,
  marks = [],
  footer = null,
  onOpen,
}: {
  thread: Thread;
  /** The module's name, shown with a stage's while the project has modules turned on. */
  moduleName?: string | null;
  marks?: readonly (ThreadMark & { threadId: string })[];
  footer?: ReactNode;
  onOpen?: (card: HTMLElement) => void;
}) {
  const labelOf = useAuthorLabel();
  if (shown.resolution == null) return null;
  const place = threadPlace(shown);
  const first = shown.messages[0];
  const latest = shown.messages.at(-1);
  const opens =
    onOpen == null
      ? {}
      : {
          role: "button",
          tabIndex: 0,
          [THREAD_BUTTON]: true,
          onClick: (event: MouseEvent<HTMLElement>) => onOpen(event.currentTarget),
          onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
            if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
            event.preventDefault();
            onOpen(event.currentTarget);
          },
        };
  return (
    <Paper
      variant="outlined"
      data-unit-card={place}
      {...opens}
      sx={{
        p: 1.5,
        display: "flex",
        flexDirection: "column",
        gap: 1,
        outline: "none",
        ...(onOpen == null ? {} : { cursor: "pointer", "&:hover": { borderColor: "primary.main" } }),
        "&:focus-visible": { boxShadow: (theme) => `0 0 0 2px ${theme.vars.palette.primary.main}` },
      }}
    >
      <Stack direction="row" sx={{ alignItems: "center", gap: 1 }}>
        <Box sx={{ minWidth: 0, flexGrow: 1 }} onClick={(event) => event.stopPropagation()}>
          {shown.unitId == null && onOpen != null ? <Typography variant="subtitle2">The stage</Typography> : <ThreadOwner thread={shown} moduleName={moduleName} />}
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
          Resolved{shown.resolution.at == null ? "" : ` ${new Date(shown.resolution.at).toLocaleString()}`}
        </Typography>
      </Stack>
      {/* The first message is a preview: a click on it opens the thread, where its mentions can be opened. */}
      {first != null && (
        <Box sx={{ display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden", pointerEvents: "none" }}>
          <WrittenText text={first.text} />
        </Box>
      )}
      {latest != null && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: "auto" }}>
          {shown.messages.length} {shown.messages.length === 1 ? "message" : "messages"} · last by {labelOf(latest)}
          {latest.at == null ? "" : `, ${new Date(latest.at).toLocaleString()}`}
        </Typography>
      )}
      {marks.map((mark) => <ThreadMarkNote key={mark.threadId} mark={mark} />)}
      {footer != null && (
        <Box sx={{ cursor: "default" }} onClick={(event) => event.stopPropagation()}>
          {footer}
        </Box>
      )}
    </Paper>
  );
});

export default ThreadCard;
