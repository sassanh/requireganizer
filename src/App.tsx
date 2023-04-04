import { observer } from "mobx-react-lite";
import React, { useMemo } from "react";

import ExportOptions from "./components/ExportOptions";
import ImportJson from "./components/ImportJson";
import Results from "./components/Results";
import Store, { storeContext } from "./store";
import {
  AcceptanceCriteria,
  Requirement,
  TestScenario,
  UserStory,
} from "./store/models";

const App: React.FunctionComponent = () => {
  const store = useMemo(() => Store.create(), []);

  const handleImport = (data: {
    productOverview: string;
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
      <ImportJson onImport={handleImport} />
      {store.isGenerating ? null : (
        <>
          <ExportOptions onExport={store.export} />
          <button onClick={store.reset}>Reset</button>
          <hr />
        </>
      )}
      <Results />
    </storeContext.Provider>
  );
};

export default observer(App);
