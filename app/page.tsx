"use client";
import { config } from "@fortawesome/fontawesome-svg-core";
import "@fortawesome/fontawesome-svg-core/styles.css"; // Import the CSS
import { observer } from "mobx-react-lite";
import { getSnapshot } from "mobx-state-tree";
import { useEffect, useState } from "react";

import { Toolbar } from "components";
import { Results } from "screens";
import { Framework, ProgrammingLanguage, Store, storeContext } from "store";
import {
  AcceptanceCriteria,
  Requirement,
  TestScenario,
  UserStory,
} from "store/models";
import { ProductOverview } from "store/models/ProductOverview";

config.autoAddCss = false;

let isStoreReloadNeeded = true;

const Home = () => {
  const [store, setStore] = useState(() => {
    isStoreReloadNeeded = false;
    return Store.create({ productOverview: {} });
  });

  useEffect(() => {
    if (isStoreReloadNeeded) {
      console.warn("Reloading store...");
      const snapshot = getSnapshot(store);
      setStore(Store.create(snapshot));
      isStoreReloadNeeded = false;
      console.warn("...reloading store done!");
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
    productOverview: ProductOverview;
    userStories: UserStory[];
    requirements: Requirement[];
    acceptanceCriteria: AcceptanceCriteria[];
    testScenarios: TestScenario[];
  }) => {
    store.import(data);
  };
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
      <Results />
    </storeContext.Provider>
  );
};

export default observer(Home);
