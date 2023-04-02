import React from "react";
import { observer } from "mobx-react-lite";
import Store from "./store";
import DescriptionInput from "./components/DescriptionInput";
import Results from "./components/Results";
import { UserStory, Requirement, AcceptanceCriteria } from "./types";
import ImportJson from "./components/ImportJson";
import ExportOptions from "./components/ExportOptions";

const store = Store.create({
  userStories: [],
  requirements: [],
  acceptanceCriteria: [],
});

const App: React.FunctionComponent = () => {
  const handleImport = (data: {
    userStories: UserStory[];
    requirements: Requirement[];
    acceptanceCriteria: AcceptanceCriteria[];
  }) => {
    store.import(data);
  };

  return (
    <div>
      {store.isClean ? (
        <>
          {store.validationErrors ? (
            <div className="validation-errors">{store.validationErrors}</div>
          ) : null}
          <ImportJson onImport={handleImport} />
          <DescriptionInput onSubmit={store.generate} />
        </>
      ) : (
        <>
          {" "}
          {store.isGenerating ? null : (
            <>
              <ExportOptions onExport={store.export} />;
              <button onClick={store.reset}>Reset</button>
              <hr />
            </>
          )}
          <Results
            userStories={store.userStories}
            requirements={store.requirements}
            acceptanceCriteria={store.acceptanceCriteria}
            onUserStoriesChange={store.setUserStories}
            onRequirementsChange={store.setRequirements}
            onAcceptanceCriteriaChange={store.setAcceptanceCriteria}
          />
        </>
      )}
    </div>
  );
};

export default observer(App);
