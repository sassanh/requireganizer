"use client";
import { ArrowBack, FolderOpen, Forum, History } from "@mui/icons-material";
import {
  AppBar,
  Box,
  Button,
  Stack,
  Toolbar,
  Tooltip,
  Typography,
} from "@mui/material";
import { observer } from "mobx-react-lite";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import {
  ConversationSidebar,
  ProjectActionsMenu,
  ImpactConfirmationDialog,
  ProviderActivity,
  PersistentAlert,
  RevisionHistoryDialog,
  ThinkingOverlayDialog,
  ValidationErrorAlert,
} from "components";
import { useProviderCallPersistence } from "hooks/useProviderCallPersistence";
import { getProjectsIndex } from "lib/projectStorage";
import { useProject } from "provider";
import { Factory } from "screens";
import { Store, useStore } from "store";

function Home() {
  const store = useStore();
  const conversationOpen = store.conversationSidebarOpen;
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
      <AppBar
        position="fixed"
        elevation={0}
        color="inherit"
        sx={{ borderBottom: 1, borderColor: "divider" }}
      >
        <Toolbar disableGutters sx={{ px: { xs: 2, md: 3 }, gap: 1.5 }}>
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
        <ProjectActionsMenu />
        <Typography variant="h6" sx={{ flexGrow: 1 }}>
          {activeProject.name}
        </Typography>
        <Tooltip title={store.hasGeneratedScaffold ? "Project files" : "Generate the project setup to enable source code"}>
          <Button
          component={Link}
          href={`/project/${encodeURIComponent(activeProject.id)}/code`}
          target="_blank"
          rel="noopener noreferrer"
          variant="outlined"
          aria-label="Project files"
          disabled={!store.hasGeneratedScaffold}
          sx={{ minWidth: 0, px: 1.25 }}
        >
          <FolderOpen />
        </Button>
        </Tooltip>
        <Tooltip title="Conversation">
          <Button
            variant={conversationOpen ? "contained" : "outlined"}
            color={conversationOpen ? "primary" : "inherit"}
            aria-label="Conversation"
            onClick={() => store.setConversationSidebar(!conversationOpen)}
            sx={{ minWidth: 0, px: 1.25 }}
          >
            <Forum />
          </Button>
        </Tooltip>
        <Tooltip title="Revisions">
          <Button
            variant="outlined"
            aria-label="Revisions"
            onClick={() => setHistoryOpen(true)}
            sx={{ minWidth: 0, px: 1.25 }}
          >
            <History />
          </Button>
        </Tooltip>
        <ProviderActivity
          calls={store.providerCalls}
          projectName={activeProject.name}
          onDelete={store.deleteProviderCall}
          onClear={store.clearProviderCalls}
        />
        </Toolbar>
      </AppBar>
      {/* Official fixed-AppBar spacer: reserves exactly the toolbar height. */}
      <Toolbar />
      <Stack
        direction="row"
        sx={{
          alignItems: "flex-start",
          gap: 2,
          // Fills the remaining viewport below the fixed-AppBar spacer so the
          // conversation sidebar can size itself to 100% of this row.
          height: { xs: "calc(100% - 56px)", sm: "calc(100% - 64px)" },
        }}
      >
        <Box
          sx={{
            flexGrow: 1,
            minWidth: 0,
            // The artifacts column is the page's scroll container: the row is
            // exactly viewport-sized, so the sidebar stays fully visible
            // without any sticky positioning while long content scrolls here.
            height: "100%",
            overflowY: "auto",
            ...(store.isBusy && { pointerEvents: "none", userSelect: "none" }),
          }}
        >
          <Suspense fallback={null}>
            <Factory activeProject={activeProject} />
          </Suspense>
        </Box>
        {conversationOpen && <ConversationSidebar />}
      </Stack>
      <ImpactConfirmationDialog projectId={activeProject.id} />
      <ThinkingOverlayDialog />
      <RevisionHistoryDialog
        projectId={activeProject.id}
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
      />
    </>
  );
}

export default observer(Home);
