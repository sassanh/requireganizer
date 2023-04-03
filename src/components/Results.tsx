import { faCog, faPlus, faRefresh } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Tab } from "@headlessui/react";
import { observer } from "mobx-react-lite";
import React, { Fragment, useContext } from "react";
import { storeContext } from "store/store";

import EditableItem from "./EditableItem";

function TabTitle({
  children,
  id,
  ...props
}: React.PropsWithChildren<{ id: string }>) {
  return (
    <Tab as={Fragment} {...props}>
      {({ selected }) => (
        <a
          href={`#${id}`}
          className={"tab" + (selected ? " selected-tab" : "")}
        >
          {children}
        </a>
      )}
    </Tab>
  );
}

const Results: React.FunctionComponent = () => {
  const store = useContext(storeContext);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) =>
    store.setDescription(e.target.value);

  return (
    <Tab.Group>
      <Tab.List>
        <TabTitle id="description">Description</TabTitle>
        <TabTitle id="user-stories">User Stories</TabTitle>
        <TabTitle id="requirements">Requirements</TabTitle>
        <TabTitle id="acceptance-criteria">Acceptance Criteria</TabTitle>
        <TabTitle id="test-scenarios">Test Scenarios</TabTitle>
      </Tab.List>

      <Tab.Panels>
        <Tab.Panel>
          <form onSubmit={store.generateFormalDescription}>
            <label htmlFor="description-input">Software Description:</label>
            <textarea
              id="description-input"
              value={store.description}
              onChange={handleChange}
              style={{ minWidth: "400px", minHeight: "100px" }}
            />
            <button
              type="submit"
              className="icon-button"
              disabled={store.isGenerating}
            >
              <FontAwesomeIcon icon={faCog} />
            </button>
          </form>
          <pre>{store.formalDescription}</pre>
        </Tab.Panel>

        <Tab.Panel>
          <button className="icon-button">
            <FontAwesomeIcon icon={faRefresh} /> Regenerate User Stories
          </button>
          <ul className="section">
            {store.userStories.map((userStory) => (
              <EditableItem
                key={userStory.id}
                item={userStory}
                onRemove={store.removeUserStory}
              />
            ))}
          </ul>
          <button className="icon-button" onClick={store.addUserStory}>
            <FontAwesomeIcon icon={faPlus} /> Add User Story
          </button>
        </Tab.Panel>

        <Tab.Panel>
          <ul className="section">
            {store.requirements.map((requirement) => (
              <EditableItem
                key={requirement.id}
                item={requirement}
                onRemove={store.removeRequirement}
              />
            ))}
          </ul>
          <button className="icon-button" onClick={store.addRequirement}>
            <FontAwesomeIcon icon={faPlus} /> Add Requirement
          </button>
        </Tab.Panel>

        <Tab.Panel>
          <ul className="section">
            {store.acceptanceCriteria.map((acceptanceCriteria) => (
              <EditableItem
                key={acceptanceCriteria.id}
                item={acceptanceCriteria}
                onRemove={store.removeAcceptanceCriteria}
              />
            ))}
          </ul>
          <button className="icon-button" onClick={store.addAcceptanceCriteria}>
            <FontAwesomeIcon icon={faPlus} /> Add Acceptance Criteria
          </button>
        </Tab.Panel>

        <Tab.Panel>
          <ul className="section">
            {store.testScenarios.map((testScenario) => (
              <EditableItem
                key={testScenario.id}
                item={testScenario}
                onRemove={store.removeTestScenario}
              >
                <ul>
                  {testScenario.testCases.map((testCase) => (
                    <EditableItem
                      key={testCase.id}
                      item={testCase}
                      onRemove={testScenario.removeTestCase}
                    />
                  ))}
                  <button
                    className="icon-button"
                    onClick={testScenario.addTestCase}
                  >
                    <FontAwesomeIcon icon={faPlus} /> Add Test Case
                  </button>
                </ul>
              </EditableItem>
            ))}
          </ul>
          <button className="icon-button" onClick={store.addTestScenario}>
            <FontAwesomeIcon icon={faPlus} /> Add Test Scenario
          </button>
        </Tab.Panel>
      </Tab.Panels>
    </Tab.Group>
  );
};

export default observer(Results);
