"use client";

import { Button, Divider, Paper, Stack, TextField, Typography } from "@mui/material";
import { observer } from "mobx-react-lite";
import { useState } from "react";

import { authorLabel, type Thread, waitsForSpecOwner } from "../threads";
import { perform, useWorkflowView } from "./context";

function Messages({ thread }: { thread: Thread }) {
  return (
    <Stack spacing={1} divider={<Divider flexItem />} sx={{ opacity: thread.resolvedAt == null ? 1 : 0.6 }}>
      {thread.messages.map((message, index) => (
        <Stack key={index} spacing={0.25}>
          <Typography variant="caption" color="text.secondary">
            {authorLabel(message.author)} · {new Date(message.at).toLocaleString()}
            {message.withChanges ? " · with changes" : ""}
          </Typography>
          <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>{message.text}</Typography>
        </Stack>
      ))}
    </Stack>
  );
}

/**
 * The threads on one unit: the resolved ones to read, the open one to
 * reply in and resolve, and the box that opens a change request.
 */
const ThreadPanel = observer(function ThreadPanel({
  unitId,
  threads,
  stageOpen,
  composing,
  onComposingChange,
}: {
  /** The unit, or null when it is gone and only its threads remain. */
  unitId: string | null;
  threads: readonly Thread[];
  stageOpen: boolean;
  composing: boolean;
  onComposingChange: (composing: boolean) => void;
}) {
  const { module } = useWorkflowView();
  const [text, setText] = useState("");
  const open = threads.find(({ resolvedAt }) => resolvedAt == null) ?? null;
  const resolved = threads.filter(({ resolvedAt }) => resolvedAt != null);
  const [showResolved, setShowResolved] = useState(false);

  const send = async () => {
    const message = text.trim();
    if (message.length === 0) return;
    const sent = await perform(
      () => (unitId == null ? module.replyAsSpecOwner(open!.id, message) : module.requestChange(unitId, message)),
      "The message could not be sent.",
    );
    if (sent) {
      setText("");
      onComposingChange(false);
    }
  };

  if (threads.length === 0 && !composing) return null;
  return (
    <Paper variant="outlined" sx={{ p: 1.5, mt: 1 }}>
      <Stack spacing={1.5}>
        {resolved.length > 0 && (
          <Button size="small" sx={{ alignSelf: "flex-start" }} onClick={() => setShowResolved(!showResolved)}>
            {showResolved ? "Hide" : "Show"} {resolved.length} resolved {resolved.length === 1 ? "thread" : "threads"}
          </Button>
        )}
        {showResolved && resolved.map((thread) => <Messages key={thread.id} thread={thread} />)}
        {open != null && (
          <>
            <Typography variant="overline" color={waitsForSpecOwner(open) ? "warning.main" : "text.secondary"}>
              {waitsForSpecOwner(open) ? "Open thread · waits for you" : module.isBeingAnswered(open.id) ? "Open thread · the coding agent is answering" : "Open thread · waits for the coding agent"}
            </Typography>
            <Messages thread={open} />
          </>
        )}
        {stageOpen && (composing || open != null) && (
          <Stack spacing={1}>
            <TextField
              autoFocus={composing}
              multiline
              minRows={2}
              size="small"
              label={open == null ? "Request a change" : "Reply"}
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void send();
                }
                if (event.key === "Escape") {
                  event.stopPropagation();
                  onComposingChange(false);
                }
              }}
            />
            <Stack direction="row" sx={{ gap: 1 }}>
              <Button size="small" variant="contained" disabled={text.trim().length === 0} onClick={() => void send()}>
                {open == null ? "Send change request" : "Send"}
              </Button>
              {open != null && (
                <Button size="small" onClick={() => void perform(() => module.resolveThread(open.id), "The thread could not be resolved.")}>
                  Resolve
                </Button>
              )}
              {composing && open == null && (
                <Button size="small" onClick={() => onComposingChange(false)}>
                  Cancel
                </Button>
              )}
            </Stack>
          </Stack>
        )}
        {!stageOpen && open != null && (
          <Typography variant="caption" color="text.secondary">
            The stage is closed: the thread takes replies again once the stages it builds on are complete.
          </Typography>
        )}
      </Stack>
    </Paper>
  );
});

export default ThreadPanel;
