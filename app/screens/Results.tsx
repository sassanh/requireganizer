import { faCog } from "@fortawesome/free-solid-svg-icons";
import { Tab } from "@headlessui/react";
import { observer } from "mobx-react-lite";
import { usePathname } from "next/navigation";
import React, { useEffect, useState } from "react";
import Textarea from "react-textarea-autosize";

import {
  IconButton,
  IterationTabTitle,
  SectionHeader,
  StructuralFragments,
} from "components";
import editableItemCss from "components/EditableItem.module.css";
import structuralFragmentsCss from "components/StructuralFragments.module.css";
import productOverviewCss from "screens/ProductOverview.module.css";
import {
  ITERATIONS,
  ITERATION_LABELS,
  Iteration,
  StructrualFragment,
  useStore,
} from "store";

import ProductOverview from "./ProductOverview";
import css from "./Results.module.css";

const Results: React.FunctionComponent = () => {
  const store = useStore();
  const path = usePathname();

  const handleDescriptionChange = (
    event: React.ChangeEvent<HTMLTextAreaElement>
  ) => store.setDescription(event.target.value);

  const [selectedTab, setSelectedTab] = useState(() => {
    // TODO: Hash is pending nextjs support
    const hash = path.match(/#([a-z0-9]+)/gi)?.[0];
    const index = ITERATIONS.indexOf(hash?.replace(/^#/, "") as Iteration);
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
      <Tab.List className={css.tabList}>
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
            className={productOverviewCss.textInput}
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
          <div className={structuralFragmentsCss.section}>
            {store.testScenarios.map((testScenario) => (
              <div
                key={testScenario.id}
                className={["borderless", editableItemCss.item].join(" ")}
              >
                <div className={editableItemCss.itemContent}>
                  {testScenario.content}
                </div>
                <IconButton
                  icon={faCog}
                  disabled={store.isGenerating}
                  onClick={() => store.generateTestCases(testScenario)}
                >
                  Generate Test Cases
                </IconButton>
                <ol className={editableItemCss.itemExtra}>
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
