import { Comment, Send } from "@mui/icons-material";
import { IconButton, Paper, Popover, TextField } from "@mui/material";
import { observer } from "mobx-react-lite";
import { ChangeEvent, useCallback, useState } from "react";

interface CommentButtonProps {
  disabled?: boolean;
  target?: HTMLElement;
  onSubmit: (comment: string) => unknown;
}

const CommentButton = ({
  disabled = false,
  target,
  onSubmit,
}: CommentButtonProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [popupRef, setPopupRef] = useState<HTMLFormElement | null>(null);
  const [buttonRef, setButtonRef] = useState<HTMLButtonElement | null>(null);

  const handleCommentOpen = useCallback(() => setIsOpen(true), []);
  const handleBlur = useCallback(
    ({ relatedTarget }: React.FocusEvent) => {
      if (popupRef !== relatedTarget && !popupRef?.contains(relatedTarget)) {
        setIsOpen(false);
      }
    },
    [popupRef],
  );

  const handleCommentChange = useCallback(
    ({ target: { value } }: ChangeEvent<HTMLTextAreaElement>) =>
      setComment(value),
    [],
  );

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (isSubmitting || comment.trim().length === 0) return;
      setIsSubmitting(true);
      try {
        await onSubmit(comment);
        setComment("");
        setIsOpen(false);
      } finally {
        setIsSubmitting(false);
      }
    },
    [comment, isSubmitting, onSubmit],
  );

  return (
    <>
      <IconButton
        aria-label="Comment"
        ref={setButtonRef}
        disabled={disabled || isSubmitting}
        onClick={handleCommentOpen}
      >
        <Comment />
      </IconButton>
      <Popover
        open={isOpen}
        onClose={() => setIsOpen(false)}
        anchorOrigin={{
          vertical: "top",
          horizontal: "right",
        }}
        anchorEl={target || buttonRef}
      >
        <Paper
          component="form"
          sx={{ p: 1 }}
          ref={setPopupRef}
          onBlur={handleBlur}
          onSubmit={handleSubmit}
        >
          <TextField
            fullWidth
            minRows={2}
            multiline
            value={comment}
            disabled={disabled || isSubmitting}
            ref={(element) => element?.focus()}
            onChange={handleCommentChange}
          />
          <IconButton
            aria-label="Send comment"
            disabled={disabled || comment.trim().length === 0}
            loading={isSubmitting}
            type="submit"
          >
            <Send />
          </IconButton>
        </Paper>
      </Popover>
    </>
  );
};

export default observer(CommentButton);
