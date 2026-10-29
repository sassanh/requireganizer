import { Button, Chip, Divider, Paper, Popper, type PopperProps, Stack, TextField, Typography } from "@mui/material";
import { keyframes, type Theme } from "@mui/material/styles";
import { observer } from "mobx-react-lite";
import { ChangeEvent, FormEvent, useCallback, useEffect, useRef, useState } from "react";

import { requestChangeAction, sendChangeRequestAction } from "actions/actions";
import { ActionView } from "actions/ActionView";
import { useStore } from "store";
import { answererLabel, authorLabel, type ReviewThread, waitsForPerson } from "store/threads";

import { animationSeconds } from "./animation";
import { sendOnEnter } from "./enterToSend";
import { formatMessageTime } from "./messageTime";

const turn = keyframes`
  from { transform: translate(-50%, -50%) rotate(0turn); }
  to { transform: translate(-50%, -50%) rotate(1turn); }
`;

/** A border that runs around the chip while an answerer is at work on the thread. */
const answeringSx = (theme: Theme) => ({
  position: "relative",
  overflow: "hidden",
  isolation: "isolate",
  borderColor: "transparent",
  "&::before": {
    content: '""',
    position: "absolute",
    top: "50%",
    left: "50%",
    width: "200%",
    aspectRatio: "1",
    zIndex: -2,
    background: `conic-gradient(${theme.vars.palette.primary.main} 0turn 0.25turn, ${theme.vars.palette.divider} 0.25turn)`,
    animation: `${turn} ${animationSeconds(1.5)}s linear infinite`,
  },
  "&::after": {
    content: '""',
    position: "absolute",
    inset: "1px",
    borderRadius: "inherit",
    zIndex: -1,
    background: theme.vars.palette.background.paper,
  },
});

type PopperModifier = NonNullable<PopperProps["modifiers"]>[number];
type PopperInstance = NonNullable<Extract<PopperProps["popperRef"], { current: unknown }>["current"]>;

type PopperState = Parameters<NonNullable<PopperModifier["fn"]>>[0]["state"];

const MARGIN = 8;

/**
 * The room above and below the popover's button within the visible part of
 * the list that scrolls it: the list's own box clipped to the window, so a
 * bar above the list or the window's edge both bound it. Ancestors that only
 * clip, such as an item's animation wrapper, do not bound a popover that
 * renders outside them.
 */
function spaceAround(state: PopperState) {
  const reference = state.rects.reference;
  const list = state.scrollParents.reference.find(
    (parent): parent is Element =>
      parent instanceof Element && /auto|scroll|overlay/.test(getComputedStyle(parent).overflowY),
  );
  const listBox = list?.getBoundingClientRect();
  const top = Math.max(0, listBox?.top ?? 0);
  const bottom = Math.min(window.innerHeight, listBox?.bottom ?? window.innerHeight);
  return {
    above: reference.y - top - MARGIN,
    below: bottom - reference.y - reference.height - MARGIN,
  };
}

/**
 * The popover stays inside the visible list: it opens on the side of its
 * button with more room and never grows past that room. A popover reaching
 * past the window would lengthen the page and scroll the whole layout; one
 * reaching above the list would slide under the bar over it.
 */
const fitListModifiers: PopperModifier[] = [
  { name: "flip", enabled: false },
  {
    name: "sideWithMoreRoom",
    enabled: true,
    phase: "main",
    fn({ state }) {
      const { above, below } = spaceAround(state);
      const placement = below >= above ? "bottom-end" : "top-end";
      if (state.placement !== placement) {
        state.placement = placement;
        state.reset = true;
      }
    },
  },
  {
    name: "heightWithinRoom",
    enabled: true,
    phase: "beforeWrite",
    requires: ["computeStyles"],
    fn({ state }) {
      const { above, below } = spaceAround(state);
      const room = state.placement.startsWith("top") ? above : below;
      state.styles.popper = { ...state.styles.popper, maxHeight: `${Math.min(room, window.innerHeight * 0.6)}px` };
    },
  },
];

interface CommentButtonProps {
  /** The reviewable unit whose change requests this shows. */
  unitId: string;
  disabled?: boolean;
  /** Resolving to `false` keeps the box open: a decision dialog still owns the comment. */
  onSubmit: (comment: string) => unknown;
}

function ThreadMessages({ thread, faded = false }: { thread: ReviewThread; faded?: boolean }) {
  return (
    <Stack spacing={1.5} divider={<Divider flexItem />} sx={{ opacity: faded ? 0.6 : 1 }}>
      {thread.messages.map((message, index) => (
        <Stack key={index} spacing={0.25}>
          <Typography variant="caption" color="text.secondary">
            <Typography component="span" variant="caption" sx={{ fontWeight: 600, color: "text.primary" }}>
              {authorLabel(message.author)}
            </Typography>
            {" · "}
            {formatMessageTime(Date.parse(message.at))}
            {message.withSubmission ? " · changed the work" : ""}
          </Typography>
          <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
            {message.text}
          </Typography>
        </Stack>
      ))}
    </Stack>
  );
}

/**
 * A unit's change requests: the button that asks for one, the open
 * thread's state, and the popover that holds the conversation. Only the
 * person resolves a thread.
 */
const CommentButton = ({
  unitId,
  disabled = false,
  onSubmit,
}: CommentButtonProps) => {
  const store = useStore();
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [comment, setComment] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showResolved, setShowResolved] = useState(false);

  const [buttonRef, setButtonRef] = useState<HTMLButtonElement | null>(null);
  const popperRef = useRef<PopperInstance | null>(null);

  const thread = store.openThreadOf(unitId);
  const resolved = store.threadsOf(unitId).filter(({ resolvedAt }) => resolvedAt != null);
  const waitingForYou = thread != null && waitsForPerson(thread);
  const answering = thread != null && store.isBeingAnswered(thread.id);
  const unit = store.reviewUnit(unitId);
  const canAskAgain =
    thread != null &&
    !waitingForYou &&
    store.threadAnswerer === "requireganizer" &&
    unit != null &&
    !store.isBusy;

  const isOpen = anchor !== null;
  // A new message changes the popover's height; placing it again keeps it in the window.
  const messageCount = thread?.messages.length ?? 0;
  useEffect(() => {
    void popperRef.current?.update();
  }, [messageCount, showResolved]);
  const openPopover = useCallback(() => {
    if (buttonRef != null) setAnchor(buttonRef);
  }, [buttonRef]);
  // Deliberately not a modal: outside pointer-down closes, Escape closes
  // and hands focus back, submit closes and hands focus back. No focus
  // trap means nothing can yank focus out from under the text area.
  useEffect(() => {
    if (anchor === null) return;
    const onPointerDown = (event: Event) => {
      // A pending submit may own the comment: an open decision dialog
      // must not take the draft away when the person cancels.
      if (isSubmitting) return;
      const target = event.target as Node | null;
      if (target == null || anchor.contains(target)) return;
      if (
        target instanceof Element &&
        target.closest("[data-comment-popover], [data-thread-state]") != null
      ) {
        return;
      }
      setAnchor(null);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [anchor, isSubmitting]);

  const handleCommentChange = useCallback(
    ({ target: { value } }: ChangeEvent<HTMLTextAreaElement>) =>
      setComment(value),
    [],
  );

  const handleSubmit = useCallback(
    async () => {
      if (isSubmitting || comment.trim().length === 0) return;
      setIsSubmitting(true);
      try {
        const result = await onSubmit(comment);
        if (result === false) return;
        setComment("");
        setAnchor(null);
        buttonRef?.focus();
      } finally {
        setIsSubmitting(false);
      }
    },
    [buttonRef, comment, isSubmitting, onSubmit],
  );

  const handleFormSubmit = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      void handleSubmit();
    },
    [handleSubmit],
  );

  return (
    <>
      {thread != null ? (
        <Chip
          size="small"
          data-thread-state
          data-thread-waiting={waitingForYou ? "" : undefined}
          aria-busy={answering || undefined}
          sx={answering ? answeringSx : undefined}
          variant={waitingForYou ? "filled" : "outlined"}
          color={waitingForYou ? "warning" : "default"}
          label={waitingForYou ? "Waiting for you" : `Waiting for ${answererLabel(store.threadAnswerer)}`}
          onClick={openPopover}
        />
      ) : null}
      <span data-comment-open={isOpen ? "" : undefined}>
        <ActionView
          variant="iconbutton"
          action={requestChangeAction}
          target={{ blocked: disabled || isSubmitting, open: openPopover }}
          size="small"
          color="primary"
          ref={setButtonRef}
        />
      </span>
      <Popper
        open={isOpen}
        anchorEl={anchor}
        placement="bottom-end"
        popperRef={popperRef}
        popperOptions={{ strategy: "fixed" }}
        modifiers={fitListModifiers}
        sx={{ display: "flex", flexDirection: "column" }}
      >
        <Paper
          component="form"
          data-comment-popover
          elevation={8}
          sx={{ p: 1.5, width: 380, minHeight: 0, overflowY: "auto" }}
          onSubmit={handleFormSubmit}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setAnchor(null);
              buttonRef?.focus();
              return;
            }
            sendOnEnter(event, () => void handleSubmit());
          }}
        >
          <Stack spacing={1.5}>
            {resolved.length > 0 ? (
              <>
                <Button size="small" sx={{ alignSelf: "flex-start" }} onClick={() => setShowResolved(!showResolved)}>
                  {showResolved ? "Hide" : "Show"} {resolved.length} resolved
                </Button>
                {showResolved
                  ? resolved.map((past) => <ThreadMessages key={past.id} thread={past} faded />)
                  : null}
                <Divider />
              </>
            ) : null}
            {thread != null ? <ThreadMessages thread={thread} /> : null}
            <Stack direction="row" sx={{ alignItems: "flex-end", gap: 0.5 }}>
              <TextField
                fullWidth
                minRows={2}
                multiline
                placeholder={thread == null ? "Describe the change" : "Reply"}
                slotProps={{ htmlInput: { "aria-label": thread == null ? "Change request" : "Reply" } }}
                value={comment}
                disabled={disabled || isSubmitting}
                autoFocus
                onChange={handleCommentChange}
              />
              <ActionView
                variant="iconbutton"
                action={sendChangeRequestAction}
                target={{
                  blocked: disabled || isSubmitting,
                  text: comment,
                  send: () => void handleSubmit(),
                }}
                submit
                loading={isSubmitting}
              />
            </Stack>
            {thread != null ? (
              <Stack direction="row" sx={{ justifyContent: "flex-end", gap: 1 }}>
                {canAskAgain ? (
                  <Button size="small" onClick={() => void store.answerThread(unit.stage, thread.id)}>
                    Ask again
                  </Button>
                ) : null}
                <Button size="small" disabled={store.isBusy} onClick={() => void store.resolveThread(thread.id)}>
                  Resolve
                </Button>
              </Stack>
            ) : null}
          </Stack>
        </Paper>
      </Popper>
    </>
  );
};

export default observer(CommentButton);
