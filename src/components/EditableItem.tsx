import React, { useState, useRef } from "react";
import { UserStory, Requirement, AcceptanceCriteria } from "../types";

interface EditableItemProps {
  item: UserStory | Requirement | AcceptanceCriteria;
  onSave: (id: string, updatedContent: string) => void;
}

const EditableItem: React.FC<EditableItemProps> = ({ item, onSave }) => {
  const [isEditing, setIsEditing] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

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
    </li>
  );
};

export default EditableItem;
