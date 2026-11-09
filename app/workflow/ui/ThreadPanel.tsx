"use client";

import { Button, Divider, Stack, TextField, Typography } from "@mui/material";
import { observer } from "mobx-react-lite";
import { useEffect, useRef, useState } from "react";

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

/** Unsent messages by unit or thread, kept while the page is open so closing a thread by accident loses nothing. */
const drafts = new Map<string, string>();

/**
 * The threads on one unit: the resolved ones to read, the open one to
 * reply in and resolve, and the box that opens a change request.
 */
const ThreadPanel = observer(function ThreadPanel({
  unitId,
  threads,
  stageOpen,
  autoFocus = false,
  onClose,
}: {
  /** The unit, or null when it is gone and only its threads remain. */
  unitId: string | null;
  threads: readonly Thread[];
  stageOpen: boolean;
  autoFocus?: boolean;
  onClose?: () => void;
}) {
  const { module } = useWorkflowView();
  const open = threads.find(({ resolvedAt }) => resolvedAt == null) ?? null;
  const resolved = threads.filter(({ resolvedAt }) => resolvedAt != null);
  const draftKey = unitId ?? open?.id ?? "";
  const [text, setTextState] = useState(() => drafts.get(draftKey) ?? "");
  const setText = (value: string) => {
    drafts.set(draftKey, value);
    setTextState(value);
  };
  const [showResolved, setShowResolved] = useState(false);

  const send = async () => {
    const message = text.trim();
    if (message.length === 0) return;
    const sent = await perform(
      () => (unitId == null ? module.replyAsSpecOwner(open!.id, message) : module.requestChange(unitId, message)),
      "The message could not be sent.",
    );
    if (sent) setText("");
  };

  // The latest message shows first: the history opens, and stays, scrolled to its end.
  const history = useRef<HTMLDivElement>(null);
  const messageCount = threads.reduce((count, thread) => count + thread.messages.length, 0);
  useEffect(() => {
    if (history.current != null) history.current.scrollTop = history.current.scrollHeight;
  }, [messageCount]);

  return (
    <Stack spacing={1.5} sx={{ minHeight: 0, flexGrow: 1 }}>
      <Stack ref={history} spacing={1.5} sx={{ minHeight: 0, flexShrink: 1, overflowY: "auto" }}>
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
      </Stack>
      {stageOpen && (unitId != null || open != null) && (
        <Stack spacing={1} sx={{ flexShrink: 0, pt: 1 }}>
          <TextField
            autoFocus={autoFocus}
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
              if (event.key === "Escape" && onClose != null) {
                event.stopPropagation();
                onClose();
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
          </Stack>
        </Stack>
      )}
      {!stageOpen && open != null && (
        <Typography variant="caption" color="text.secondary">
          The stage is closed: the thread takes replies again once the stages it builds on are complete.
        </Typography>
      )}
    </Stack>
  );
});

export default ThreadPanel;
