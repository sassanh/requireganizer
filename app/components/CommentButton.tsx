import { Comment, Send } from "@mui/icons-material";
import { IconButton, Paper, Popper, TextField, Tooltip } from "@mui/material";
import { observer } from "mobx-react-lite";
import { ChangeEvent, FormEvent, MouseEvent, useCallback, useEffect, useState } from "react";

import { COMMENT_SHORTCUT_KEY } from "hooks/useCommentShortcut";

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
  const handleOpen = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setAnchor(event.currentTarget);
  }, []);
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
    async (event: FormEvent) => {
      event.preventDefault();
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

  return (
    <>
      <Tooltip title={`Request change (${COMMENT_SHORTCUT_KEY.toUpperCase()})`}>
        <IconButton
          aria-label="Request change"
          color='primary'
          data-comment-button
          data-comment-open={isOpen ? "" : undefined}
          ref={setButtonRef}
          size="small"
          disabled={disabled || isSubmitting}
          onClick={handleOpen}
        >
          <Comment />
        </IconButton>
      </Tooltip>
      <Popper
        open={isOpen}
        anchorEl={anchor}
        placement="top-end"
      >
        <Paper
          component="form"
          data-comment-popover
          sx={{ p: 1, width: 320 }}
          onSubmit={handleSubmit}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            setAnchor(null);
            buttonRef?.focus();
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
          <IconButton
            aria-label="Send change request"
            disabled={disabled || comment.trim().length === 0}
            loading={isSubmitting}
            type="submit"
          >
            <Send />
          </IconButton>
        </Paper>
      </Popper>
    </>
  );
};

export default observer(CommentButton);
