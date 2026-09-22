"use client";
import { ArrowBack, FolderOpen, Forum, History } from "@mui/icons-material";
import {
  Alert,
  AlertTitle,
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
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { switchModuleShortcut } from "actions/actions";
import {
  ConversationSidebar,
  ModuleSwitcherDialog,
  ProjectActionsMenu,
  ImpactConfirmationDialog,
  ProviderActivity,
  PersistentAlert,
  RevisionHistoryDialog,
  ThinkingOverlayDialog,
  ValidationErrorAlert,
} from "components";
import {
  isEditableTarget,
  isOverlayTarget,
  useShortcut,
  type ShortcutBinding,
} from "hooks/shortcuts";
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
    consumeOverviewSeed,
    backToProjects,
    clearPersistenceError,
    modulesEnabled,
    activeModuleId,
    activeModuleOpenStep,
    switchModule,
  } = useProject();
  const params = useParams();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [modulesOpen, setModulesOpen] = useState(false);

  const projectId = params?.id as string;
  const providerCallPersistenceError = useProviderCallPersistence(
    activeProject?.id === projectId ? projectId : null,
    activeProject?.id === projectId && activeModuleId !== "" ? activeModuleId : null,
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

  useEffect(() => {
    if (activeProject?.id !== projectId) return;
    const seed = consumeOverviewSeed(projectId);
    if (seed == null) return;
    void store.generateProductOverview(seed);
  }, [activeProject, projectId, consumeOverviewSeed, store]);

  const openModules = useCallback(() => setModulesOpen(true), []);
  const closeModules = useCallback(() => setModulesOpen(false), []);

  const modulesBinding = useMemo<ShortcutBinding>(
    () => ({
      id: "show-modules",
      ...switchModuleShortcut,
      when: (event) =>
        activeProject?.id === projectId &&
        !isEditableTarget(event.target) &&
        !isOverlayTarget(event.target),
      action: openModules,
    }),
    [activeProject, projectId, openModules],
  );
  useShortcut(modulesBinding);

  // `?module=` is the open project's module pointer: navigation into a
  // module (deep link, back button) switches to it; whenever the interface
  // itself switches, the effect below writes the pointer back.
  const seenModuleParamRef = useRef<string | null>(null);
  const pendingUrlModuleRef = useRef<string | null>(null);
  useEffect(() => {
    if (activeProject?.id !== projectId || !modulesEnabled) return;
    const inUrl = searchParams.get("module");
    const seen = seenModuleParamRef.current;
    seenModuleParamRef.current = inUrl;
    if (inUrl === seen) return;
    if (inUrl == null || inUrl === activeModuleId) return;
    pendingUrlModuleRef.current = inUrl;
    if (!switchModule(inUrl)) {
      // Unknown id: the state-owns-URL effect below rewrites the pointer.
      pendingUrlModuleRef.current = null;
    }
  }, [activeProject, projectId, modulesEnabled, searchParams, activeModuleId, switchModule]);

  useEffect(() => {
    if (activeProject?.id !== projectId || !modulesEnabled) return;
    const inUrl = searchParams.get("module");
    if (inUrl === activeModuleId) {
      pendingUrlModuleRef.current = null;
      return;
    }
    // A URL-driven switch is landing: the URL already names the destination.
    if (pendingUrlModuleRef.current != null && pendingUrlModuleRef.current === inUrl) {
      return;
    }
    const next = new URLSearchParams(searchParams.toString());
    next.set("module", activeModuleId);
    // Arriving from another module lands on that module's remembered stage.
    if (inUrl != null) next.set("step", activeModuleOpenStep);
    router.replace(`${pathname}?${next.toString()}`);
  }, [activeProject, projectId, modulesEnabled, searchParams, activeModuleId, activeModuleOpenStep, router, pathname]);

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
          onRetry={
            store.canRetryFailedOperation()
              ? () => {
                  void store.retryFailedOperation();
                }
              : undefined
          }
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
        <ProjectActionsMenu onShowModules={openModules} />
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
        <Tooltip title="Agent">
          <Button
            variant={conversationOpen ? "contained" : "outlined"}
            color={conversationOpen ? "primary" : "inherit"}
            aria-label="Agent"
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
            minHeight: 0,
            height: "100%",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            ...(store.isBusy && { pointerEvents: "none", userSelect: "none" }),
          }}
        >
          {store.systemMessage && (
            <Alert
              severity="success"
              sx={{ flexShrink: 0, zIndex: 2 }}
            >
              <AlertTitle>Needs Action!</AlertTitle>
              <div>{store.systemMessage}</div>
            </Alert>
          )}
          <Box sx={{ flexGrow: 1, minHeight: 0, minWidth: 0, display: "flex" }}>
            <Suspense fallback={null}>
              <Factory activeProject={activeProject} />
            </Suspense>
          </Box>
        </Box>
        {conversationOpen && <ConversationSidebar />}
      </Stack>
      <ImpactConfirmationDialog projectId={activeProject.id} moduleId={activeModuleId} />
      <ThinkingOverlayDialog />
      <RevisionHistoryDialog
        projectId={activeProject.id}
        moduleId={activeModuleId}
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
      />
      <ModuleSwitcherDialog open={modulesOpen} onClose={closeModules} />
    </>
  );
}

export default observer(Home);
