import { faTrash } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { observer } from "mobx-react-lite";
import { useRef } from "react";
import Textarea from "react-textarea-autosize";
import { StructuralFragment } from "store/models";

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
    <li className="item" onClick={focus} {...props}>
      <span className="item-content">
        <Textarea
          ref={contentRef}
          onChange={handleChange}
          onKeyUp={handleKeyUp}
          value={fragment.content}
        />
      </span>
      <button
        className="item-action icon-button"
        id={fragment.id}
        onClick={handleRemove}
      >
        <FontAwesomeIcon icon={faTrash} />
      </button>
      {children != null ? <div className="item-extra">{children}</div> : null}
    </li>
  );
};

export default observer(EditableItem);
