import React, { useState, useRef } from "react";
import { UserStory, Requirement, AcceptanceCriteria } from "../types";

interface EditableItemProps {
  item: UserStory | Requirement | AcceptanceCriteria;
  onRemove: (id: string) => void;
  onSave: (id: string, updatedContent: string) => void;
}

const EditableItem: React.FunctionComponent<EditableItemProps> = ({
  item,
  onRemove,
  onSave,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const handleRemove = () => {
    onRemove(item.id);
  };

  const handleSave = () => {
    if (contentRef.current) {
      const updatedContent = contentRef.current.innerText;
      onSave(item.id, updatedContent);
    }
    setIsEditing(false);
  };

  return (
    <li>
      <div
        ref={contentRef}
        contentEditable={isEditing}
        suppressContentEditableWarning={true}
      >
        {item.content}
      </div>
      {isEditing ? (
        <button onClick={handleSave}>Save</button>
      ) : (
        <button onClick={() => setIsEditing(true)}>Edit</button>
      )}
      <button id={item.id} onClick={handleRemove}>
        Remove
      </button>
    </li>
  );
};

export default EditableItem;
