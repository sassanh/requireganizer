import { ExportOptions, ImportJson } from "components";
import { observer } from "mobx-react-lite";
import React, { useMemo } from "react";
import { Results } from "screens";

import { Store, storeContext } from "./store";
import {
  AcceptanceCriteria,
  Requirement,
  TestScenario,
  UserStory,
} from "./store/models";

const App: React.FunctionComponent = () => {
  const store = useMemo(() => Store.create(), []);

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
