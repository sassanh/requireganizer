import { faTrash } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { observer } from "mobx-react-lite";
import { useRef } from "react";
import { StructuralFragment } from "store/models";

interface EditableItemProps<Type extends StructuralFragment>
  extends React.PropsWithChildren {
  item: Type;
  onRemove: (item: Type) => void;
}

const EditableItem = <Type extends StructuralFragment>({
  children,
  item,
  onRemove,
}: EditableItemProps<Type>) => {
  const contentRef = useRef<HTMLDivElement>(null);

  const handleRemove = () => {
    onRemove(item);
  };

  const handleSave = () => {
    if (contentRef.current) {
      const updatedText = contentRef.current.innerText;
      item.updateContent(updatedText);
    }
  };

  return (
    <li className="item">
      <div
        className="item-content"
        ref={contentRef}
        onBlur={handleSave}
        contentEditable
        dangerouslySetInnerHTML={{
          __html: item.content,
        }}
      />
      <button
        className="item-action icon-button"
        id={item.id}
        onClick={handleRemove}
      >
        <FontAwesomeIcon icon={faTrash} />
      </button>
      {children}
    </li>
  );
};

export default observer(EditableItem);
