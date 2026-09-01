import { Comment, Send } from "@mui/icons-material";
import { IconButton, Paper, Popover, TextField } from "@mui/material";
import { observer } from "mobx-react-lite";
import { ChangeEvent, FocusEvent, FormEvent, MouseEvent, useCallback, useState } from "react";

interface CommentButtonProps {
  disabled?: boolean;
  onSubmit: (comment: string) => unknown;
}

const CommentButton = ({
  disabled = false,
  onSubmit,
}: CommentButtonProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [popupRef, setPopupRef] = useState<HTMLFormElement | null>(null);
  const [buttonRef, setButtonRef] = useState<HTMLButtonElement | null>(null);

  const handleOpen = useCallback((event: MouseEvent) => {
    event.stopPropagation();
    setIsOpen(true);
  }, []);
  const handleBlur = useCallback(
    ({ relatedTarget }: FocusEvent) => {
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
    async (event: FormEvent) => {
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
        aria-label="Request change"
        color='primary'
        ref={setButtonRef}
        size="small"
        disabled={disabled || isSubmitting}
        onClick={handleOpen}
      >
        <Comment />
      </IconButton>
      <Popover
        open={isOpen}
        onClose={() => setIsOpen(false)}
        anchorOrigin={{ vertical: "top", horizontal: "right" }}
        transformOrigin={{ vertical: "bottom", horizontal: "right" }}
        anchorEl={buttonRef}
      >
        <Paper
          component="form"
          sx={{ p: 1, width: 320 }}
          ref={setPopupRef}
          onBlur={handleBlur}
          onSubmit={handleSubmit}
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
      </Popover>
    </>
  );
};

export default observer(CommentButton);
