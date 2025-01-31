"use client";
import { Divider } from "@mui/material";
import { observer } from "mobx-react-lite";
import { Suspense, useEffect } from "react";

import { Toolbar } from "components";
import { Factory } from "screens";
import { Framework, ProgrammingLanguage, Store, useStore } from "store";
import {
  AcceptanceCriteria,
  Requirement,
  TestScenario,
  UserStory,
} from "store/models";
import { ProductOverview } from "store/models/ProductOverview";

function Home() {
  const store = useStore();

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
    <>
      {store.validationErrors ? (
        <div className="validation-errors">{store.validationErrors}</div>
      ) : null}
      <Toolbar
        disabled={store.isBusy}
        onImport={handleImport}
        onExport={store.export}
        onReset={store.reset}
      />
      <Divider sx={{ my: 2 }} />
      <Suspense fallback={null}>
        <Factory />
      </Suspense>
    </>
  );
}

export default observer(Home);
