import { Comment, Send } from "@mui/icons-material";
import { IconButton, Paper, Popover, TextField } from "@mui/material";
import { observer } from "mobx-react-lite";
import { ChangeEvent, useCallback, useState } from "react";

interface CommentButtonProps {
  disabled?: boolean;
  target?: HTMLElement;
  onSubmit: (comment: string) => void;
}

const CommentButton = ({
  disabled = false,
  target,
  onSubmit,
}: CommentButtonProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [comment, setComment] = useState("");

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
    (event: React.FormEvent) => {
      event.preventDefault();
      onSubmit(comment);
    },
    [onSubmit, comment],
  );

  return (
    <>
      <IconButton
        ref={setButtonRef}
        disabled={disabled}
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
            ref={(element) => element?.focus()}
            onChange={handleCommentChange}
          />
          <IconButton tabIndex={0} type="submit" onClick={handleSubmit}>
            <Send />
          </IconButton>
        </Paper>
      </Popover>
    </>
  );
};

export default observer(CommentButton);
