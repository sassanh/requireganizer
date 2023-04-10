import { faTrash } from "@fortawesome/free-solid-svg-icons";
import { observer } from "mobx-react-lite";
import { useRef } from "react";
import Textarea from "react-textarea-autosize";

import { StructuralFragment } from "store/models";

import css from "./EditableItem.module.css";
import { IconButton } from "./controls";

interface EditableItemProps<Type extends StructuralFragment>
  extends React.LiHTMLAttributes<HTMLLIElement> {
  fragment: Type;
  onRemove: (fragment: Type) => void;
}

const EditableItem = <Type extends StructuralFragment>({
  children,
  fragment,
  onRemove,
  ...props
}: EditableItemProps<Type>) => {
  const contentRef = useRef<HTMLTextAreaElement>(null);

  const handleRemove = () => {
    onRemove(fragment);
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
    <li className={css.item} onClick={focus} {...props}>
      <span className={css.itemContent}>
        <Textarea
          ref={contentRef}
          onChange={handleChange}
          onKeyUp={handleKeyUp}
          value={fragment.content}
        />
      </span>
      <IconButton
        icon={faTrash}
        className={css.itemAction}
        onClick={handleRemove}
      />
      {children != null ? (
        <div className={css.itemExtra}>{children}</div>
      ) : null}
    </li>
  );
};

export default observer(EditableItem);
