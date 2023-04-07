import {
  faArrowRight,
  faCog,
  faPlus,
  faRefresh,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Tab } from "@headlessui/react";
import { EditableItem, Header } from "components";
import { observer } from "mobx-react-lite";
import React, { Fragment, useContext, useEffect, useState } from "react";
import Textarea from "react-textarea-autosize";
import { Iteration, storeContext } from "store";


function TabTitle({
  children,
  id,
  ...props
}: React.PropsWithChildren<
  React.AnchorHTMLAttributes<HTMLAnchorElement> | { id: string }
>) {
  return (
    <Tab as={Fragment}>
      {({ selected }) => (
        <a
          href={`#${id}`}
          className={"tab" + (selected ? " selected-tab" : "")}
          {...props}
        >
          {children}
        </a>
      )}
    </Tab>
  );
}

const TABS = Object.values(Iteration) as string[];
const TAB_LABELS = new Map([
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

  const handleProductOverviewChange = (
    e: React.ChangeEvent<HTMLTextAreaElement>
  ) => store.setProductOverview(e.target.value);

  const [selectedTab, setSelectedTab] = useState(() => {
    return TABS.indexOf(window.location.hash.replace(/^#/, ""));
  });

  useEffect(() => {
    if (selectedTab >= 0) {
      window.location.hash = TABS[selectedTab];
    }
  }, [selectedTab]);

  useEffect(() => {
    function setSelectedTabByName(iteration: Iteration) {
      setSelectedTab(TABS.indexOf(iteration));
    }

    store.eventTarget.on("iterationUpdate", setSelectedTabByName);

    return () => {
      store.eventTarget.off("iterationUpdate", setSelectedTabByName);
    };
  }, [store.eventTarget]);

  return (
    <Tab.Group selectedIndex={selectedTab} onChange={setSelectedTab}>
      <Tab.List className="tab-list">
        {Object.values(Iteration).map((tab: Iteration) => (
          <TabTitle id={tab} key={tab}>
            {TAB_LABELS.get(tab)}
          </TabTitle>
        ))}
      </Tab.List>

      <Tab.Panels>
        <Tab.Panel>
          <Header
            title="Software Description:"
            right={
              <button
                className="icon-button"
                disabled={store.isGenerating}
                onClick={store.generateProductOverview}
              >
                <FontAwesomeIcon icon={faArrowRight} />{" "}
                <FontAwesomeIcon icon={faCog} /> Generate Product Overview
              </button>
            }
          />
          <Textarea
            className="description"
            id="description-input"
            value={store.description}
            onChange={handleDescriptionChange}
          />
        </Tab.Panel>

        <Tab.Panel>
          <Header
            title={<pre>Product Overview</pre>}
            left={
              <button
                className="icon-button"
                onClick={store.generateProductOverview}
              >
                <FontAwesomeIcon icon={faRefresh} />{" "}
                <FontAwesomeIcon icon={faCog} /> Regenerate Product Overview
              </button>
            }
            right={
              <button
                className="icon-button"
                onClick={store.generateUserStories}
              >
                <FontAwesomeIcon icon={faArrowRight} />{" "}
                <FontAwesomeIcon icon={faCog} /> Generate User Stories
              </button>
            }
          />

          <pre>
            <Textarea
              className="product-overview"
              value={store.productOverview || ""}
              onChange={handleProductOverviewChange}
            />
          </pre>
        </Tab.Panel>

        <Tab.Panel>
          <Header
            title="User Stories"
            left={
              <button
                className="icon-button"
                onClick={store.generateUserStories}
              >
                <FontAwesomeIcon icon={faRefresh} /> Regenerate User Stories
              </button>
            }
            right={
              <button
                className="icon-button"
                onClick={store.generateRequirements}
              >
                <FontAwesomeIcon icon={faArrowRight} />{" "}
                <FontAwesomeIcon icon={faCog} /> Generate Requirements
              </button>
            }
          />

          <div className="section">
            <ul>
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
          </div>
        </Tab.Panel>

        <Tab.Panel>
          <Header
            title="Requirements"
            left={
              <button
                className="icon-button"
                onClick={store.generateRequirements}
              >
                <FontAwesomeIcon icon={faRefresh} /> Regenerate Requirements
              </button>
            }
            right={
              <button
                className="icon-button"
                onClick={store.generateAcceptanceCriteria}
              >
                <FontAwesomeIcon icon={faArrowRight} />{" "}
                <FontAwesomeIcon icon={faCog} /> Generate Acceptance Criteria
              </button>
            }
          />

          <div className="section">
            <ul>
              {store.requirements.map((requirement) => (
                <EditableItem
                  key={requirement.id}
                  item={requirement}
                  onRemove={store.removeRequirement}
                />
              ))}
            </ul>{" "}
            <button className="icon-button" onClick={store.addRequirement}>
              <FontAwesomeIcon icon={faPlus} /> Add Requirement
            </button>
          </div>
        </Tab.Panel>

        <Tab.Panel>
          <Header
            title="Acceptance Criteria"
            left={
              <button
                className="icon-button"
                onClick={store.generateAcceptanceCriteria}
              >
                <FontAwesomeIcon icon={faRefresh} /> Regenerate Acceptance
                Criteria
              </button>
            }
            right={
              <button
                className="icon-button"
                onClick={store.generateTestScenarios}
              >
                <FontAwesomeIcon icon={faArrowRight} />{" "}
                <FontAwesomeIcon icon={faCog} /> Generate Test Scenarios
              </button>
            }
          />

          <div className="section">
            <ul>
              {store.acceptanceCriteria.map((acceptanceCriteria) => (
                <EditableItem
                  key={acceptanceCriteria.id}
                  item={acceptanceCriteria}
                  onRemove={store.removeAcceptanceCriteria}
                />
              ))}
            </ul>
            <button
              className="icon-button"
              onClick={store.addAcceptanceCriteria}
            >
              <FontAwesomeIcon icon={faPlus} /> Add Acceptance Criteria
            </button>
          </div>
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
