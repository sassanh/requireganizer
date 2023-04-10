"use client";
import { config } from "@fortawesome/fontawesome-svg-core";
import { observer } from "mobx-react-lite";
import { Inter } from "next/font/google";
import { useEffect, useMemo } from "react";

import "@fortawesome/fontawesome-svg-core/styles.css"; // Import the CSS
import { Combobox, ImportExportOptions } from "components";
import { Results } from "screens";
import {
  Framework,
  PROGRAMMING_LANGUAGE_BY_FRAMEWORK,
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

const inter = Inter({ subsets: ["latin"] });

// TODO:
console.log(inter);

let store = Store.create();

const Home = () => {
  // For easier debugging store is saved under window.store variable in development environment
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { store: Store }).store = store;
    }
  }, []);

  const handleImport = (data: {
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
    [store.framework]
  );

  return (
    <storeContext.Provider value={store}>
      {store.validationErrors ? (
        <div className="validation-errors">{store.validationErrors}</div>
      ) : null}
      {store.isGenerating ? null : (
        <>
          <ImportExportOptions
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
              onChange={store.setFramework}
            />
            <Combobox
              items={programmingLanguages}
              label="Programming Language"
              value={store.programmingLanguage}
              onChange={store.setProgrammingLanguage}
            />
          </div>
          <hr />
        </>
      )}
      <Results />
    </storeContext.Provider>
  );
};

export default observer(Home);
