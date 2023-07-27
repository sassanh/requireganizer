import { faComment, faSquarePlus } from "@fortawesome/free-solid-svg-icons";
import { observer } from "mobx-react-lite";
import { ChangeEvent, useCallback, useState } from "react";
import Textarea from "react-textarea-autosize";

import css from "./CommentButton.module.css";
import { IconButton, usePopup } from "./controls";
import { Placement } from "./controls/popup/utilities";

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

  const [popupRef, setPopupRef] = useState<HTMLDivElement | null>(null);
  const [buttonRef, setButtonRef] = useState<HTMLButtonElement | null>(null);

  const handleCommentOpen = useCallback(() => setIsOpen(true), []);
  const handleBlur = useCallback(
    ({ relatedTarget }: React.FocusEvent) => {
      if (popupRef !== relatedTarget && !popupRef?.contains(relatedTarget)) {
        setIsOpen(false);
      }
    },
    [popupRef]
  );

  const handleCommentChange = useCallback(
    ({ target: { value } }: ChangeEvent<HTMLTextAreaElement>) =>
      setComment(value),
    []
  );

  const handleSubmit = useCallback(() => {
    console.log(comment);
    onSubmit(comment);
  }, [onSubmit, comment]);

  const { popup } = usePopup({
    content: (
      <div className={css.popup} ref={setPopupRef} onBlur={handleBlur}>
        <Textarea
          className={css.input}
          minRows={2}
          value={comment}
          ref={(element) => element?.focus()}
          onChange={handleCommentChange}
        />
        <IconButton
          className={css.submitButton}
          tabIndex={0}
          icon={faSquarePlus}
          onClick={handleSubmit}
        />
      </div>
    ),
    target: target || buttonRef,
    placement: Placement.RightTop,
    isVisible: isOpen,
  });

  return (
    <>
      <IconButton
        ref={setButtonRef}
        disabled={disabled}
        icon={faComment}
        onClick={handleCommentOpen}
      />
      {popup}
    </>
  );
};

export default observer(CommentButton);
