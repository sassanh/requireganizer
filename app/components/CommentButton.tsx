import { Paper, Popper, TextField } from "@mui/material";
import { observer } from "mobx-react-lite";
import { ChangeEvent, FormEvent, useCallback, useEffect, useState } from "react";

import { requestChangeAction, sendChangeRequestAction } from "actions/actions";
import { ActionView } from "actions/ActionView";

import { sendOnEnter } from "./enterToSend";

interface CommentButtonProps {
  disabled?: boolean;
  onSubmit: (comment: string) => unknown;
}

const CommentButton = ({
  disabled = false,
  onSubmit,
}: CommentButtonProps) => {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [comment, setComment] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [buttonRef, setButtonRef] = useState<HTMLButtonElement | null>(null);

  const isOpen = anchor !== null;
  const openPopover = useCallback(() => {
    if (buttonRef != null) setAnchor(buttonRef);
  }, [buttonRef]);
  // Deliberately not a modal: outside pointer-down closes, Escape closes
  // and hands focus back, submit closes and hands focus back. No focus
  // trap means nothing can yank focus out from under the text area.
  useEffect(() => {
    if (anchor === null) return;
    const onPointerDown = (event: Event) => {
      const target = event.target as Node | null;
      if (target == null || anchor.contains(target)) return;
      if (
        target instanceof HTMLElement &&
        target.closest("[data-comment-popover]") != null
      ) {
        return;
      }
      setAnchor(null);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [anchor]);

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
        await onSubmit(comment);
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
        placement="top-end"
      >
        <Paper
          component="form"
          data-comment-popover
          sx={{ p: 1, width: 320 }}
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
          <TextField
            fullWidth
            minRows={2}
            multiline
            label="Change request"
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
        </Paper>
      </Popper>
    </>
  );
};

export default observer(CommentButton);
