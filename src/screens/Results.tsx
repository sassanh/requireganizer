import { Tab } from "@headlessui/react";
import { Header, IterationTabTitle, StructuralFragments } from "components";
import { observer } from "mobx-react-lite";
import React, { useEffect, useState } from "react";
import Textarea from "react-textarea-autosize";
import { Iteration, useStore } from "store";
import {
  ITERATIONS,
  ITERATION_LABELS,
  StructrualFragment,
} from "store/utilities";

const Results: React.FunctionComponent = () => {
  const store = useStore();

  const handleDescriptionChange = (
    event: React.ChangeEvent<HTMLTextAreaElement>
  ) => store.setDescription(event.target.value);

  const handleProductOverviewChange = (
    e: React.ChangeEvent<HTMLTextAreaElement>
  ) => store.setProductOverview(e.target.value);

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

  useEffect(() => {
    function setSelectedTabByName(iteration: Iteration) {
      setSelectedTab(ITERATIONS.indexOf(iteration));
    }

    const eventTarget = store.eventTarget;

    eventTarget.on("iterationUpdate", setSelectedTabByName);
    return () => {
      eventTarget.off("iterationUpdate", setSelectedTabByName);
    };
  }, [store.eventTarget]);

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
          <Header iteration={Iteration.description} />
          <Textarea
            className="description"
            value={store.description}
            onChange={handleDescriptionChange}
          />
        </Tab.Panel>

        <Tab.Panel>
          <Header iteration={Iteration.productOverview} />

          <pre>
            <Textarea
              className="product-overview"
              value={store.productOverview || ""}
              onChange={handleProductOverviewChange}
            />
          </pre>
        </Tab.Panel>

        <Tab.Panel>
          <Header iteration={Iteration.userStories} />
          <StructuralFragments
            fragments={store.userStories}
            structuralFragment={StructrualFragment.userStory}
            onAddFragment={store.addUserStory}
            onRemoveFragment={store.removeUserStory}
          />
        </Tab.Panel>

        <Tab.Panel>
          <Header iteration={Iteration.requirements} />
          <StructuralFragments
            fragments={store.requirements}
            structuralFragment={StructrualFragment.requirement}
            onAddFragment={store.addRequirement}
            onRemoveFragment={store.removeRequirement}
          />
        </Tab.Panel>

        <Tab.Panel>
          <Header iteration={Iteration.acceptanceCriteria} />
          <StructuralFragments
            fragments={store.acceptanceCriteria}
            structuralFragment={StructrualFragment.acceptanceCriteria}
            onAddFragment={store.addAcceptanceCriteria}
            onRemoveFragment={store.removeAcceptanceCriteria}
          />
        </Tab.Panel>

        <Tab.Panel>
          <Header iteration={Iteration.testScenarios} />
          <StructuralFragments
            fragments={store.testScenarios}
            structuralFragment={StructrualFragment.testScenario}
            onAddFragment={store.addTestScenario}
            onRemoveFragment={store.removeTestScenario}
          />
        </Tab.Panel>

        <Tab.Panel>
          <Header iteration={Iteration.testCases} />
          <div className="section">
            {store.testScenarios.map((testScenario) => (
              <div className="borderless item">
                <div className="item-content">{testScenario.content}</div>
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
