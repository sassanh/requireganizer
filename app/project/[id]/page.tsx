"use client";
import { ArrowBack, FolderOpen, History } from "@mui/icons-material";
import { Button, Divider, Stack, Typography } from "@mui/material";
import { observer } from "mobx-react-lite";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import {
  ImpactConfirmationDialog,
  ProviderActivity,
  PersistentAlert,
  RevisionHistoryDialog,
  Toolbar,
  ValidationErrorAlert,
} from "components";
import { useProviderCallPersistence } from "hooks/useProviderCallPersistence";
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
  const [historyOpen, setHistoryOpen] = useState(false);

  const projectId = params?.id as string;
  const providerCallPersistenceError = useProviderCallPersistence(
    activeProject?.id === projectId ? projectId : null,
    store,
  );

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
        <PersistentAlert severity="warning" onClose={clearPersistenceError}>
          {persistenceError}
        </PersistentAlert>
      )}
      {providerCallPersistenceError && (
        <PersistentAlert severity="warning">
          {providerCallPersistenceError}
        </PersistentAlert>
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
        <Button
          component={Link}
          href={`/project/${encodeURIComponent(activeProject.id)}/code`}
          target="_blank"
          rel="noopener noreferrer"
          variant="outlined"
          startIcon={<FolderOpen />}
          disabled={!store.hasGeneratedScaffold}
        >
          Project files
        </Button>
        <Button variant="outlined" startIcon={<History />} onClick={() => setHistoryOpen(true)}>
          Revisions
        </Button>
        <ProviderActivity
          calls={store.providerCalls}
          projectName={activeProject.name}
          onDelete={store.deleteProviderCall}
          onClear={store.clearProviderCalls}
        />
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
      <ImpactConfirmationDialog projectId={activeProject.id} />
      <RevisionHistoryDialog
        projectId={activeProject.id}
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
      />
    </>
  );
}

export default observer(Home);
