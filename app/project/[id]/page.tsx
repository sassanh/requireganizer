"use client";
import { ArrowBack } from "@mui/icons-material";
import { Button, Divider, Stack, Typography } from "@mui/material";
import { observer } from "mobx-react-lite";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Suspense, useEffect } from "react";

import { Toolbar } from "components";
import { useProject } from "provider";
import { Factory } from "screens";
import { getProjectsIndex } from "screens/ProjectSelector";
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
  const { activeProject, selectProject, backToProjects } = useProject();
  const params = useParams();
  const router = useRouter();

  const projectId = params?.id as string;

  useEffect(() => {
    if (projectId && activeProject?.id !== projectId) {
      const projects = getProjectsIndex();
      const projectMeta = projects.find((p) => p.id === projectId);
      if (projectMeta) {
        selectProject(projectMeta.id, projectMeta.name);
      } else {
        router.push("/");
      }
    }
  }, [projectId, activeProject, selectProject, router]);

  // For easier debugging store is saved under window.store variable in development environment
  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useEffect(() => {
      (window as unknown as { store: Store }).store = store;
    }, [store]);
  }

  if (!activeProject || activeProject.id !== projectId) {
    return null; // Return null while loading to avoid flashing the selector or empty state
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
      <Stack
        direction="row"
        sx={{
          alignItems: "center",
          gap: 2
        }}>
        <Button
          component={Link}
          href="/"
          variant="text"
          startIcon={<ArrowBack />}
          onClick={backToProjects}
          disabled={store.isBusy}
        >
          Projects
        </Button>
        <Typography variant="h6" sx={{ flexGrow: 1 }}>
          {activeProject.name}
        </Typography>
      </Stack>
      <Toolbar
        disabled={store.isBusy}
        exportCodeDisabled={!store.hasGeneratedScaffold}
        onExportCode={store.exportCode}
        onImport={handleImport}
        onExport={store.export}
        onReset={store.reset}
      />
      <Divider sx={{ my: 2 }} />
      <Suspense fallback={null}>
        <Factory activeProject={activeProject} />
      </Suspense>
    </>
  );
}

export default observer(Home as React.FC);
