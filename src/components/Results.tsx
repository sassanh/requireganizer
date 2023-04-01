import React from "react";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Box from "@mui/material/Box";
import EditableItem from "./EditableItem";
import { UserStory, Requirement, AcceptanceCriteria } from "../types";
import { uuid } from "../utilities";

function TabPanel(props: any) {
  const { children, value, index } = props;
  return (
    <div hidden={value !== index}>
      {value === index && <Box>{children}</Box>}
    </div>
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

  const [tabValue, setTabValue] = React.useState(0);
  const handleTabChange = (_: React.ChangeEvent<{}>, newValue: number) => {
    setTabValue(newValue);
  };

  return (
    <div>
      <Tabs value={tabValue} onChange={handleTabChange}>
        <Tab label="User Stories" />
        <Tab label="Requirements" />
        <Tab label="Acceptance Criteria" />
      </Tabs>

      <TabPanel value={tabValue} index={0}>
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
          <button onClick={handleAddUserStory}>Add User Story</button>
        </div>
      </TabPanel>

      <TabPanel value={tabValue} index={1}>
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
          <button onClick={handleAddRequirement}>Add Requirement</button>
        </div>
      </TabPanel>

      <TabPanel value={tabValue} index={2}>
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
            Add Acceptance Criteria
          </button>
        </div>
      </TabPanel>
    </div>
  );
};

export default Results;
