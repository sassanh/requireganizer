import { faEdit, faSave, faTrash } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { observer } from "mobx-react-lite";
import { useRef, useState } from "react";
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
  const [isEditing, setIsEditing] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const handleRemove = () => {
    onRemove(item);
  };

  const handleSave = () => {
    if (contentRef.current) {
      const updatedText = contentRef.current.innerText;
      item.updateContent(updatedText);
    }
    setIsEditing(false);
  };

  return (
    <li className="item">
      <div
        ref={contentRef}
        contentEditable={isEditing}
        dangerouslySetInnerHTML={{
          __html: item.content,
        }}
      />
      {isEditing ? (
        <button className="icon-button" onClick={handleSave}>
          <FontAwesomeIcon icon={faSave} />
        </button>
      ) : (
        <button className="icon-button" onClick={() => setIsEditing(true)}>
          <FontAwesomeIcon icon={faEdit} />
        </button>
      )}
      <button className="icon-button" id={item.id} onClick={handleRemove}>
        <FontAwesomeIcon icon={faTrash} />
      </button>
      {children}
    </li>
  );
};

export default observer(EditableItem);
