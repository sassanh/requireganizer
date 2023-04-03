import { faCog, faPlus } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Tab } from "@headlessui/react";
import { observer } from "mobx-react-lite";
import React, { Fragment, useContext } from "react";
import { storeContext } from "store/store";

import DescriptionInput from "./DescriptionInput";
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
          <DescriptionInput onSubmit={store.generate} />
          <button className="icon-button">
            <FontAwesomeIcon icon={faCog} />
          </button>
          <pre>{store.description}</pre>
        </Tab.Panel>

        <Tab.Panel>
          <button className="icon-button">
            <FontAwesomeIcon icon={faCog} />
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
            <FontAwesomeIcon icon={faPlus} />
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
            <FontAwesomeIcon icon={faPlus} />
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
            <FontAwesomeIcon icon={faPlus} />
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
                    <FontAwesomeIcon icon={faPlus} />
                  </button>
                </ul>
              </EditableItem>
            ))}
          </ul>
          <button className="icon-button" onClick={store.addTestScenario}>
            <FontAwesomeIcon icon={faPlus} />
          </button>
        </Tab.Panel>
      </Tab.Panels>
    </Tab.Group>
  );
};

export default observer(Results);
