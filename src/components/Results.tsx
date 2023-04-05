import { faCog, faPlus, faRefresh } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Tab } from "@headlessui/react";
import { observer } from "mobx-react-lite";
import React, { Fragment, useContext, useEffect, useState } from "react";
import Textarea from "react-textarea-autosize";
import { Iteration, storeContext } from "store";

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

const TABS = new Map([
  [Iteration.description, "Description"],
  [Iteration.productOverview, "Product Overview"],
  [Iteration.userStories, "User Stories"],
  [Iteration.requirements, "Requirements"],
  [Iteration.acceptanceCriteria, "Acceptance Criteria"],
  [Iteration.testScenarios, "Test Scenarios"],
]);

const Results: React.FunctionComponent = () => {
  const store = useContext(storeContext);

  const handleDescriptionChange = (e: React.ChangeEvent<HTMLTextAreaElement>) =>
    store.setDescription(e.target.value);

  const handleDescriptionSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    store.generateProductOverview();
  };

  const handleProductOverviewChange = (
    e: React.ChangeEvent<HTMLTextAreaElement>
  ) => store.setProductOverview(e.target.value);

  const [selectedTab, setSelectedTab] = useState(() =>
    Object.keys(TABS).indexOf(window.location.hash.replace(/^#/, ""))
  );

  useEffect(() => {
    window.location.hash = Object.keys(TABS)[selectedTab];
  }, [selectedTab]);

  useEffect(() => {
    function setSelectedTabByName(iteration: Iteration) {
      console.log(iteration);
      setSelectedTab(Object.keys(TABS).indexOf(iteration));
    }

    store.eventTarget.on("iterationUpdate", setSelectedTabByName);

    return () => {
      store.eventTarget.off("iterationUpdate", setSelectedTabByName);
    };
  }, [store.eventTarget]);

  return (
    <Tab.Group selectedIndex={selectedTab} onChange={setSelectedTab}>
      <Tab.List>
        {Array.from(TABS.keys()).map((tab: Iteration) => (
          <TabTitle id={tab} key={tab}>
            {TABS.get(tab)}
          </TabTitle>
        ))}
      </Tab.List>

      <Tab.Panels>
        <Tab.Panel>
          <form onSubmit={handleDescriptionSubmit}>
            <label htmlFor="description-input">
              <h2>Software Description:</h2>
            </label>
            <Textarea
              className="description"
              id="description-input"
              value={store.description}
              onChange={handleDescriptionChange}
            />
            <button
              type="submit"
              className="icon-button"
              disabled={store.isGenerating}
            >
              <FontAwesomeIcon icon={faCog} /> Generate Product Overview
            </button>
          </form>
        </Tab.Panel>

        <Tab.Panel>
          {store.productOverview != null ? (
            <pre>
              <h2>Product Overview:</h2>
              <Textarea
                className="product-overview"
                value={store.productOverview}
                onChange={handleProductOverviewChange}
              />
            </pre>
          ) : null}
        </Tab.Panel>

        <Tab.Panel>
          <button className="icon-button" onClick={store.generateUserStories}>
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
          <button className="icon-button" onClick={store.generateRequirements}>
            <FontAwesomeIcon icon={faRefresh} /> Regenerate Requirements
          </button>
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
