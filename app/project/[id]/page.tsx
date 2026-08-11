"use client";
import { ArrowBack } from "@mui/icons-material";
import { Alert, Button, Divider, Stack, Typography } from "@mui/material";
import { observer } from "mobx-react-lite";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Suspense, useEffect } from "react";

import { Toolbar, ValidationErrorAlert } from "components";
import { getProjectsIndex } from "lib/projectStorage";
import { useProject } from "provider";
import { Factory } from "screens";
import { Store, useStore } from "store";

function Home() {
  const store = useStore();
  const {
    activeProject,
    persistenceError,
    selectProject,
    backToProjects,
    clearPersistenceError,
  } = useProject();
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
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { store: Store }).store = store;
    }
  }, [store]);

  if (!activeProject || activeProject.id !== projectId) {
    return null; // Return null while loading to avoid flashing the selector or empty state
  }

  return (
    <>
      {persistenceError && (
        <Alert
          severity="warning"
          onClose={clearPersistenceError}
          sx={{ mb: 2 }}
        >
          {persistenceError}
        </Alert>
      )}
      {store.validationErrors ? (
        <ValidationErrorAlert
          message={store.validationErrors}
          details={store.validationErrorDetails}
          onClose={store.resetValidationErrors}
        />
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
        onImport={store.import}
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

export default observer(Home);
