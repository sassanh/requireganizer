"use client";
import { config } from "@fortawesome/fontawesome-svg-core";
import "@fortawesome/fontawesome-svg-core/styles.css"; // Import the CSS
import { observer } from "mobx-react-lite";
import { getSnapshot } from "mobx-state-tree";
import { useEffect, useMemo, useState } from "react";

import { Combobox, Toolbar } from "components";
import { Results } from "screens";
import {
  Framework,
  PROGRAMMING_LANGUAGE_BY_FRAMEWORK,
  ProgrammingLanguage,
  Store,
  storeContext,
} from "store";
import {
  AcceptanceCriteria,
  Requirement,
  TestScenario,
  UserStory,
} from "store/models";

config.autoAddCss = false;

let isStoreReloadNeeded = true;

const Home = () => {
  const [store, setStore] = useState(() => {
    isStoreReloadNeeded = false;
    return Store.create();
  });

  useEffect(() => {
    if (isStoreReloadNeeded) {
      console.log("Reloading store...");
      const snapshot = getSnapshot(store);
      setStore(Store.create(snapshot));
      isStoreReloadNeeded = false;
      console.log("...reloading store done!");
    }
  }, [store]);

  // For easier debugging store is saved under window.store variable in development environment
  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useEffect(() => {
      (window as unknown as { store: Store }).store = store;
    }, [store]);
  }

  const handleImport = (data: {
    programmingLanguage: ProgrammingLanguage;
    framework: Framework;
    description: string;
    productOverview: string;
    userStories: UserStory[];
    requirements: Requirement[];
    acceptanceCriteria: AcceptanceCriteria[];
    testScenarios: TestScenario[];
  }) => {
    store.import(data);
  };

  const frameworks = useMemo(() => Object.values(Framework), []);
  const programmingLanguages = useMemo(
    () =>
      store.framework ? PROGRAMMING_LANGUAGE_BY_FRAMEWORK[store.framework] : [],
    [store.framework],
  );

  return (
    <storeContext.Provider value={store}>
      {store.validationErrors ? (
        <div className="validation-errors">{store.validationErrors}</div>
      ) : null}
      <Toolbar
        disabled={store.isBusy}
        onImport={handleImport}
        onExport={store.export}
        onReset={store.reset}
      />
      <hr />

      <div
        style={{
          display: "flex",
          gap: "8px",
          justifyContent: "space-between",
        }}
      >
        <Combobox
          items={frameworks}
          label="Framework"
          value={store.framework}
          onChange={(framework) => store.setFramework({ framework })}
        />
        <Combobox
          items={programmingLanguages}
          label="Programming Language"
          value={store.programmingLanguage}
          onChange={(programmingLanguage) =>
            store.setProgrammingLanguage({ programmingLanguage })
          }
        />
      </div>
      <hr />
      <Results />
    </storeContext.Provider>
  );
};

export default observer(Home);
