import React, { Fragment } from "react";
import { Tab } from "@headlessui/react";
import { faPlus } from "@fortawesome/free-solid-svg-icons";
import EditableItem from "./EditableItem";
import { UserStory, Requirement, AcceptanceCriteria } from "../types";
import { uuid } from "../utilities";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

function TabTitle({ children, ...props }: React.PropsWithChildren<{}>) {
  return (
    <Tab as={Fragment} {...props}>
      {({ selected }) => (
        <button className={"tab" + (selected ? " selected-tab" : "")}>
          {children}
        </button>
      )}
    </Tab>
  );
}

interface ResultsProps {
  userStories: UserStory[];
  requirements: Requirement[];
  acceptanceCriteria: AcceptanceCriteria[];
  onUserStoriesChange: (userStories: UserStory[]) => void;
  onRequirementsChange: (requirements: Requirement[]) => void;
  onAcceptanceCriteriaChange: (
    acceptanceCriteria: AcceptanceCriteria[]
  ) => void;
}

const Results: React.FunctionComponent<ResultsProps> = ({
  userStories,
  requirements,
  acceptanceCriteria,
  onUserStoriesChange,
  onRequirementsChange,
  onAcceptanceCriteriaChange,
}) => {
  const handleAddUserStory = () => {
    onUserStoriesChange([
      ...userStories,
      { id: uuid(), content: "New User Story" },
    ]);
  };
  const handleAddRequirement = () => {
    onRequirementsChange([
      ...requirements,
      { id: uuid(), content: "New Requirement" },
    ]);
  };
  const handleAddAcceptanceCriteria = () => {
    onAcceptanceCriteriaChange([
      ...acceptanceCriteria,
      { id: uuid(), content: "New Acceptance Criteria" },
    ]);
  };

  const handleSaveUserStory = (id: string, updatedContent: string) => {
    const updatedUserStories = userStories.map((userStory) =>
      userStory.id === id
        ? { ...userStory, content: updatedContent }
        : userStory
    );
    onUserStoriesChange(updatedUserStories);
  };
  const handleSaveRequirement = (id: string, updatedContent: string) => {
    const updatedRequirements = requirements.map((requirement) =>
      requirement.id === id
        ? { ...requirement, content: updatedContent }
        : requirement
    );
    onRequirementsChange(updatedRequirements);
  };
  const handleSaveAcceptanceCriteria = (id: string, updatedContent: string) => {
    const updatedAcceptanceCriteria = acceptanceCriteria.map((criteria) =>
      criteria.id === id ? { ...criteria, content: updatedContent } : criteria
    );
    onAcceptanceCriteriaChange(updatedAcceptanceCriteria);
  };

  const handleRemoveUserStory = (id: string) => {
    onUserStoriesChange(userStories.filter((userStory) => userStory.id !== id));
  };
  const handleRemoveRequirement = (id: string) => {
    onRequirementsChange(
      requirements.filter((requirement) => requirement.id !== id)
    );
  };
  const handleRemoveAcceptanceCriteria = (id: string) => {
    onAcceptanceCriteriaChange(
      acceptanceCriteria.filter(
        (acceptanceCriteria) => acceptanceCriteria.id !== id
      )
    );
  };

  return (
    <Tab.Group>
      <Tab.List>
        <TabTitle>User Stories</TabTitle>
        <TabTitle>Requirements</TabTitle>
        <TabTitle>Acceptance Criteria</TabTitle>
      </Tab.List>

      <Tab.Panels>
        <Tab.Panel>
          <div className="section">
            {userStories.map((userStory) => (
              <div key={userStory.id} className="item">
                <EditableItem
                  item={userStory}
                  onRemove={handleRemoveUserStory}
                  onSave={handleSaveUserStory}
                />
              </div>
            ))}
            <button onClick={handleAddUserStory}>
              <FontAwesomeIcon icon={faPlus} />
            </button>
          </div>
        </Tab.Panel>

        <Tab.Panel>
          <div className="section">
            {requirements.map((requirement) => (
              <div key={requirement.id} className="item">
                <EditableItem
                  item={requirement}
                  onRemove={handleRemoveRequirement}
                  onSave={handleSaveRequirement}
                />
              </div>
            ))}
            <button onClick={handleAddRequirement}>
              <FontAwesomeIcon icon={faPlus} />
            </button>
          </div>
        </Tab.Panel>

        <Tab.Panel>
          <div className="section">
            {acceptanceCriteria.map((acceptanceCriteria) => (
              <div key={acceptanceCriteria.id} className="item">
                <EditableItem
                  item={acceptanceCriteria}
                  onRemove={handleRemoveAcceptanceCriteria}
                  onSave={handleSaveAcceptanceCriteria}
                />
              </div>
            ))}
            <button onClick={handleAddAcceptanceCriteria}>
              <FontAwesomeIcon icon={faPlus} />
            </button>
          </div>
        </Tab.Panel>
      </Tab.Panels>
    </Tab.Group>
  );
};

export default Results;
