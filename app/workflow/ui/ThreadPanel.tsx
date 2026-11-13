"use client";

import { Button, Divider, Stack, Typography } from "@mui/material";
import { observer } from "mobx-react-lite";
import { useEffect, useRef, useState } from "react";

import { autoScrollBehavior } from "lib/scroll";

import { authorLabel, type Thread, waitsForSpecOwner } from "../threads";
import { answeringSx } from "./answering";
import { type MessagePlace, messageAttributes, messageElement, perform, useWorkflowView } from "./context";
import MentionField from "./MentionField";
import MessageText from "./MessageText";

/** A thread's messages, each one focusable, so the page can return to the one an item was opened from. */
function Messages({ thread }: { thread: Thread }) {
  return (
    <Stack spacing={1} divider={<Divider flexItem />} sx={{ opacity: thread.resolution == null ? 1 : 0.6 }}>
      {thread.messages.map((message, index) => (
        <Stack
          key={index}
          spacing={0.25}
          tabIndex={-1}
          {...messageAttributes(thread, index)}
          sx={{ borderRadius: 1, outline: "none", "&:focus": { boxShadow: (theme) => `0 0 0 2px ${theme.vars.palette.primary.main}` } }}
        >
          <Typography variant="caption" color="text.secondary">
            {authorLabel(message.author)}{message.at == null ? "" : ` · ${new Date(message.at).toLocaleString()}`}
            {message.withChanges ? " · with changes" : ""}
          </Typography>
          <MessageText text={message.text} />
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
  focusMessage = null,
  onMessageFocused,
  onClose,
}: {
  /** The unit, or null when it is gone and only its threads remain. */
  unitId: string | null;
  threads: readonly Thread[];
  stageOpen: boolean;
  autoFocus?: boolean;
  /** A message to show and focus, if it is in these threads, such as the one an item was opened from. */
  focusMessage?: MessagePlace | null;
  onMessageFocused?: () => void;
  onClose?: () => void;
}) {
  const { module } = useWorkflowView();
  const open = threads.find(({ resolution }) => resolution == null) ?? null;
  const resolved = threads.filter(({ resolution }) => resolution != null);
  const answering = open != null && module.isBeingAnswered(open.id);
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

  // The latest message shows first: the history opens at its end, then follows new messages there smoothly.
  const history = useRef<HTMLDivElement>(null);
  const opened = useRef(false);
  const messageCount = threads.reduce((count, thread) => count + thread.messages.length, 0);
  useEffect(() => {
    const element = history.current;
    if (element == null) return;
    element.scrollTo({ top: element.scrollHeight, behavior: opened.current ? autoScrollBehavior() : "auto" });
    opened.current = true;
  }, [messageCount]);

  // A message to return to shows, among the resolved threads too, and takes the focus.
  const messageToFocus = focusMessage != null && threads.some(({ id }) => id === focusMessage.threadId) ? focusMessage : null;
  const focusInResolved = messageToFocus != null && resolved.some(({ id }) => id === messageToFocus.threadId);
  const resolvedShown = showResolved || focusInResolved;
  useEffect(() => {
    if (messageToFocus == null) return;
    if (focusInResolved) setShowResolved(true);
    const element = history.current == null ? null : messageElement(history.current, messageToFocus);
    element?.focus();
    onMessageFocused?.();
  }, [messageToFocus, focusInResolved, onMessageFocused]);

  return (
    <Stack spacing={1.5} sx={{ minHeight: 0, flexGrow: 1 }}>
      {open != null && (
        <Typography
          variant="overline"
          aria-busy={answering || undefined}
          color={waitsForSpecOwner(open) ? "warning.main" : "text.secondary"}
          sx={[{ alignSelf: "flex-start", flexShrink: 0, px: 1, borderRadius: 1 }, answering && answeringSx]}
        >
          {waitsForSpecOwner(open) ? "Open thread · waits for you" : answering ? "Open thread · the coding agent is answering" : "Open thread · waits for the coding agent"}
        </Typography>
      )}
      <Stack ref={history} spacing={1.5} sx={{ minHeight: 0, flexShrink: 1, overflowY: "auto" }}>
        {resolved.length > 0 && (
          <Button size="small" sx={{ alignSelf: "flex-start" }} onClick={() => setShowResolved(!resolvedShown)}>
            {resolvedShown ? "Hide" : "Show"} {resolved.length} resolved {resolved.length === 1 ? "thread" : "threads"}
          </Button>
        )}
        {resolvedShown && resolved.map((thread) => <Messages key={thread.id} thread={thread} />)}
        {open != null && <Messages thread={open} />}
      </Stack>
      {stageOpen && (unitId != null || open != null) && (
        <Stack spacing={1} sx={{ flexShrink: 0, pt: 1 }}>
          <MentionField
            autoFocus={autoFocus}
            multiline
            minRows={2}
            size="small"
            label={open == null ? "Request a change" : "Reply"}
            value={text}
            onChange={setText}
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
