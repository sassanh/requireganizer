import React from "react";
import { UserStory, Requirement, AcceptanceCriteria } from "../types";
import EditableItem from "./EditableItem";

interface ResultsProps {
  userStories: UserStory[];
  requirements: Requirement[];
  acceptanceCriteria: AcceptanceCriteria[];
  onUserStoriesChange: (updatedUserStories: UserStory[]) => void;
  onRequirementsChange: (updatedRequirements: Requirement[]) => void;
  onAcceptanceCriteriaChange: (
    updatedAcceptanceCriteria: AcceptanceCriteria[]
  ) => void;
}

const Results: React.FC<ResultsProps> = ({
  userStories,
  requirements,
  acceptanceCriteria,
  onUserStoriesChange,
  onRequirementsChange,
  onAcceptanceCriteriaChange,
}) => {
  const handleUserStorySave = (id: string, updatedContent: string) => {
    const updatedUserStories = userStories.map((userStory) =>
      userStory.id === id
        ? { ...userStory, content: updatedContent }
        : userStory
    );
    onUserStoriesChange(updatedUserStories);
  };
  const handleRequirementSave = (id: string, updatedContent: string) => {
    const updatedRequirements = requirements.map((requirement) =>
      requirement.id === id
        ? { ...requirement, content: updatedContent }
        : requirement
    );
    onRequirementsChange(updatedRequirements);
  };

  const handleAcceptanceCriteriaSave = (id: string, updatedContent: string) => {
    const updatedAcceptanceCriteria = acceptanceCriteria.map((criteria) =>
      criteria.id === id ? { ...criteria, content: updatedContent } : criteria
    );
    onAcceptanceCriteriaChange(updatedAcceptanceCriteria);
  };

  return (
    <div>
      <h2>User Stories</h2>
      <ul>
        {userStories.map((story) => (
          <EditableItem
            key={story.id}
            item={story}
            onSave={handleUserStorySave}
          />
        ))}
      </ul>
      <h2>Requirements</h2>
      <ul>
        {requirements.map((req) => (
          <EditableItem
            key={req.id}
            item={req}
            onSave={handleRequirementSave}
          />
        ))}
      </ul>
      <h2>Acceptance Criteria</h2>
      <ul>
        {acceptanceCriteria.map((criteria) => (
          <EditableItem
            key={criteria.id}
            item={criteria}
            onSave={handleAcceptanceCriteriaSave}
          />
        ))}
      </ul>
    </div>
  );
};

export default Results;
