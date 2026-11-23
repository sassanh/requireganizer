"use client";

import { Box, Chip, Stack, Typography } from "@mui/material";
import { observer } from "mobx-react-lite";
import type { ReactNode } from "react";

import { useWorkflowView } from "./context";
import { useAuthorLabel, useThreadWait } from "./slots";
import ThreadOwner from "./ThreadOwner";
import { THREAD_BUTTON, threadsAt } from "./ThreadView";
import WrittenText from "./WrittenText";

/**
 * The open thread at one place of the module the view shows, on one line
 * where it fits: whom it waits for, in the attention colour while that is
 * the spec owner; what it is on, the way there, and, on the stage itself,
 * that it keeps the stage from being complete; and its last message cut to
 * one line. Shown in its own stage, with `onOpenHere`, a thread on the stage
 * itself is on "the stage", which opens it there. Nothing shows once no
 * thread there is open.
 */
const ThreadRow = observer(function ThreadRow({
  stage,
  place,
  who: whoGiven,
  moduleName = null,
  context = null,
  actions = null,
  onOpenHere,
}: {
  stage: string;
  /** Where the thread is, as `threadPlace` names it. */
  place: string;
  /** Whom it waits for, in place of what the page's modules say, such as with since when. */
  who?: string;
  /** The module's name, shown with a stage's while the project has modules turned on. */
  moduleName?: string | null;
  /** Shown before what the thread is on, such as its module and stage. */
  context?: ReactNode;
  /** Shown at the end of the row; its controls act alone. */
  actions?: ReactNode;
  onOpenHere?: (anchor: HTMLElement) => void;
}) {
  const labelOf = useAuthorLabel();
  const { module } = useWorkflowView();
  const waitOf = useThreadWait();
  const threads = threadsAt(module, stage, place);
  const thread = threads.find(({ resolution }) => resolution == null);
  if (thread == null) return null;
  const { forSpecOwner, who } = waitOf(thread);
  const last = thread.messages.at(-1);
  return (
    <Stack
      direction="row"
      data-thread-row={place}
      sx={{
        alignItems: "center",
        columnGap: 1,
        flexWrap: "wrap",
        minWidth: 0,
        pl: 1,
        borderLeft: 3,
        borderColor: forSpecOwner ? "warning.main" : "divider",
      }}
    >
      <Typography variant="caption" sx={{ fontWeight: 700, whiteSpace: "nowrap", color: forSpecOwner ? "warning.main" : "text.secondary" }}>
        {whoGiven ?? who}
      </Typography>
      {context}
      {thread.unitId == null && onOpenHere != null ? (
        <Chip size="small" variant="outlined" label="The stage" {...{ [THREAD_BUTTON]: true }} onClick={(event) => onOpenHere(event.currentTarget)} />
      ) : (
        <ThreadOwner thread={thread} moduleName={moduleName} />
      )}
      {thread.unitId == null && (
        <Typography variant="caption" color="warning.main" sx={{ whiteSpace: "nowrap" }}>
          keeps it from being complete
        </Typography>
      )}
      {/* The last message is a preview: the thread shows it in full, where its mentions can be opened. */}
      {last != null && (
        <Box sx={{ flex: "1 1 200px", minWidth: 0, display: "-webkit-box", WebkitLineClamp: 1, WebkitBoxOrient: "vertical", overflow: "hidden", pointerEvents: "none", color: "text.secondary", "& p": { m: 0 } }}>
          <WrittenText text={`${labelOf(last)}: ${last.text}`} />
        </Box>
      )}
      {actions}
    </Stack>
  );
});

export default ThreadRow;
