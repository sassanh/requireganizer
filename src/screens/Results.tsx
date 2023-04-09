import { faCog } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Tab } from "@headlessui/react";
import {
  IterationTabTitle,
  SectionHeader,
  StructuralFragments,
} from "components";
import { observer } from "mobx-react-lite";
import React, { useEffect, useState } from "react";
import Textarea from "react-textarea-autosize";
import {
  ITERATIONS,
  ITERATION_LABELS,
  Iteration,
  StructrualFragment,
  useStore,
} from "store";

import ProductOverview from "./ProductOverview";

const Results: React.FunctionComponent = () => {
  const store = useStore();

  const handleDescriptionChange = (
    event: React.ChangeEvent<HTMLTextAreaElement>
  ) => store.setDescription(event.target.value);

  const [selectedTab, setSelectedTab] = useState(() => {
    const index = ITERATIONS.indexOf(
      window.location.hash.replace(/^#/, "") as Iteration
    );
    if (index !== -1) {
      return index;
    }
    return 0;
  });

  useEffect(() => {
    if (selectedTab >= 0) {
      window.location.hash = ITERATIONS[selectedTab];
    }
  }, [selectedTab]);

  const eventTarget = store.eventTarget;
  useEffect(() => {
    function setSelectedTabByName(iteration: Iteration) {
      setSelectedTab(ITERATIONS.indexOf(iteration));
    }

    eventTarget.on("iterationUpdate", setSelectedTabByName);
    return () => {
      eventTarget.off("iterationUpdate", setSelectedTabByName);
    };
  }, [eventTarget]);

  return (
    <Tab.Group selectedIndex={selectedTab} onChange={setSelectedTab}>
      <Tab.List className="tab-list">
        {Object.values(Iteration).map((tab: Iteration) => (
          <IterationTabTitle id={tab} key={tab}>
            {ITERATION_LABELS.get(tab)}
          </IterationTabTitle>
        ))}
      </Tab.List>
      <Tab.Panels>
        <Tab.Panel>
          <SectionHeader iteration={Iteration.description} />
          <Textarea
            className="description"
            value={store.description}
            onChange={handleDescriptionChange}
          />
        </Tab.Panel>

        <Tab.Panel>
          <SectionHeader iteration={Iteration.productOverview} />
          <ProductOverview />
        </Tab.Panel>

        <Tab.Panel>
          <SectionHeader iteration={Iteration.userStories} />
          <StructuralFragments
            fragments={store.userStories}
            structuralFragment={StructrualFragment.userStory}
            onAddFragment={store.addUserStory}
            onRemoveFragment={store.removeUserStory}
          />
        </Tab.Panel>

        <Tab.Panel>
          <SectionHeader iteration={Iteration.requirements} />
          <StructuralFragments
            fragments={store.requirements}
            structuralFragment={StructrualFragment.requirement}
            onAddFragment={store.addRequirement}
            onRemoveFragment={store.removeRequirement}
          />
        </Tab.Panel>

        <Tab.Panel>
          <SectionHeader iteration={Iteration.acceptanceCriteria} />
          <StructuralFragments
            fragments={store.acceptanceCriteria}
            structuralFragment={StructrualFragment.acceptanceCriteria}
            onAddFragment={store.addAcceptanceCriteria}
            onRemoveFragment={store.removeAcceptanceCriteria}
          />
        </Tab.Panel>

        <Tab.Panel>
          <SectionHeader iteration={Iteration.testScenarios} />
          <StructuralFragments
            fragments={store.testScenarios}
            structuralFragment={StructrualFragment.testScenario}
            onAddFragment={store.addTestScenario}
            onRemoveFragment={store.removeTestScenario}
          />
        </Tab.Panel>

        <Tab.Panel>
          <SectionHeader iteration={Iteration.testCases} />
          <div className="section">
            {store.testScenarios.map((testScenario) => (
              <div key={testScenario.id} className="borderless item">
                <div className="item-content">{testScenario.content}</div>
                <button
                  className="icon-button"
                  disabled={store.isGenerating}
                  onClick={() => store.generateTestCases(testScenario)}
                >
                  <FontAwesomeIcon icon={faCog} /> Generate Test Cases
                </button>
                <ol className="item-extra">
                  <StructuralFragments
                    fragments={testScenario.testCases}
                    structuralFragment={StructrualFragment.testCase}
                    onAddFragment={testScenario.addTestCase}
                    onRemoveFragment={testScenario.removeTestCase}
                  />
                </ol>
              </div>
            ))}
          </div>
        </Tab.Panel>
      </Tab.Panels>
    </Tab.Group>
  );
};

export default observer(Results);
