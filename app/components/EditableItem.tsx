import { faTrash } from "@fortawesome/free-solid-svg-icons";
import { observer } from "mobx-react-lite";
import { useRef } from "react";
import Textarea from "react-textarea-autosize";

import { StructuralFragment } from "store/models";

import CommentButton from "./CommentButton";
import css from "./EditableItem.module.css";
import { IconButton } from "./controls";

interface EditableItemProps<Type extends StructuralFragment>
  extends React.LiHTMLAttributes<HTMLLIElement> {
  isDisabled: boolean;
  fragment: Type;
  onComment: (fragment: Type, comment: string) => void;
  onRemove: (fragment: Type) => void;
}

const EditableItem = <Type extends StructuralFragment>({
  children,
  isDisabled,
  fragment,
  onComment,
  onRemove,
  ...props
}: EditableItemProps<Type>) => {
  const contentRef = useRef<HTMLTextAreaElement>(null);

  const handleRemove = () => {
    onRemove(fragment);
  };

  const handleComment = (comment: string) => {
    onComment(fragment, comment);
  };

  const handleChange = ({
    target: { value },
  }: React.ChangeEvent<HTMLTextAreaElement>) => {
    fragment.updateContent(value);
  };

  const handleKeyUp = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.currentTarget.blur();
    }
  };

  const focus = () => {
    contentRef.current?.focus();
  };

  return (
    <li
      className={css.item}
      onClick={focus}
      data-fragment={`${fragment.type}:${fragment.id}`}
      {...props}
    >
      <span className={css.itemContent}>
        <Textarea
          ref={contentRef}
          onChange={handleChange}
          onKeyUp={handleKeyUp}
          value={fragment.content}
        />
      </span>
      <div className={css.itemAction}>
        <IconButton
          disabled={isDisabled}
          icon={faTrash}
          onClick={handleRemove}
        />
        <CommentButton disabled={isDisabled} onSubmit={handleComment} />
      </div>
      {children != null ? (
        <div className={css.itemExtra}>{children}</div>
      ) : null}
    </li>
  );
};

export default observer(EditableItem);
