"use client";
import { ArrowBack } from "@mui/icons-material";
import {
  Alert,
  AlertTitle,
  AppBar,
  Box,
  Button,
  Stack,
  Toolbar,
  Typography,
} from "@mui/material";
import { observer } from "mobx-react-lite";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { switchModuleShortcut } from "actions/actions";
import {
  ModuleSwitcherDialog,
  ProjectActionsMenu,
  OutsideChangeDialog,
  PersistentAlert,
} from "components";
import {
  isEditableTarget,
  isOverlayTarget,
  useShortcut,
  type ShortcutBinding,
} from "hooks/shortcuts";
import { rememberedModule, rememberModule } from "lib/viewState";
import { usePersistence, useProject } from "projectContext";
import { Factory } from "screens";
import { Store, useStore } from "store";

function Home() {
  const store = useStore();
  const {
    status,
    activeProject,
    persistenceError,
    selectProject,
    takeOverProject,
    backToProjects,
    clearPersistenceError,
    modulesEnabled,
    modules,
    activeModuleId,
    switchModule,
    storage,
  } = useProject();
  const activeModuleName = modules.find(({ id }) => id === activeModuleId)?.name ?? null;
  const persistence = usePersistence();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [modulesOpen, setModulesOpen] = useState(false);

  const projectId = searchParams.get("id") ?? "";

  useEffect(() => {
    if (!projectId || activeProject?.id === projectId) return;
    let cancelled = false;
    void persistence.projects.list().then((projects) => {
      if (cancelled) return;
      const projectMeta = projects.find((p) => p.id === projectId);
      if (projectMeta) {
        void selectProject(projectMeta.id, projectMeta.name);
      } else {
        router.push("/");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, activeProject, selectProject, router, persistence]);

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
  const [refusedUrlModules, noteRefusedUrlModule] = useReducer(
    (count: number) => count + 1,
    0,
  );
  // The module this page last showed comes back once when the project
  // opens here without a module in the address. Until that switch lands,
  // the pointer effects wait, so they never undo it.
  const restoringRef = useRef<{ projectId: string; moduleId: string | null } | null>(null);
  useEffect(() => {
    if (activeProject?.id !== projectId || !modulesEnabled) return;
    if (restoringRef.current?.projectId === projectId) return;
    const remembered = rememberedModule(projectId);
    const wanted =
      searchParams.get("module") == null &&
      remembered != null &&
      remembered !== activeModuleId &&
      modules.some(({ id }) => id === remembered)
        ? remembered
        : null;
    restoringRef.current = { projectId, moduleId: wanted };
    if (wanted == null) return;
    void switchModule(wanted).finally(() => {
      if (restoringRef.current?.moduleId === wanted) restoringRef.current = { projectId, moduleId: null };
      noteRefusedUrlModule();
    });
  }, [activeProject, projectId, modulesEnabled, searchParams, activeModuleId, modules, switchModule]);
  const restoring = () => restoringRef.current?.moduleId != null;
  useEffect(() => {
    if (activeProject?.id !== projectId || !modulesEnabled || restoring()) return;
    rememberModule(projectId, activeModuleId);
  }, [activeProject, projectId, modulesEnabled, activeModuleId, refusedUrlModules]);
  useEffect(() => {
    if (activeProject?.id !== projectId || !modulesEnabled || restoring()) return;
    const inUrl = searchParams.get("module");
    const seen = seenModuleParamRef.current;
    seenModuleParamRef.current = inUrl;
    if (inUrl === seen) return;
    if (inUrl == null || inUrl === activeModuleId) return;
    pendingUrlModuleRef.current = inUrl;
    void switchModule(inUrl).then((switched) => {
      if (switched || pendingUrlModuleRef.current !== inUrl) return;
      // Unknown id: the state-owns-URL effect below rewrites the pointer.
      pendingUrlModuleRef.current = null;
      noteRefusedUrlModule();
    });
  }, [activeProject, projectId, modulesEnabled, searchParams, activeModuleId, switchModule]);

  useEffect(() => {
    if (activeProject?.id !== projectId || !modulesEnabled || restoring()) return;
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
    // Arriving from another module lands on the stage this page remembers
    // for it, with no unit of the other module focused.
    if (inUrl != null) {
      next.delete("step");
      next.delete("unit");
    }
    router.replace(`${pathname}?${next.toString()}`);
  }, [activeProject, projectId, modulesEnabled, searchParams, activeModuleId, router, pathname, refusedUrlModules]);

  // For easier debugging store is saved under window.store variable in development environment
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { store: Store }).store = store;
    }
  }, [store]);

  if (status === "elsewhere" && activeProject?.id === projectId) {
    return (
      <Stack sx={{ alignItems: "center", py: 6, px: 2 }}>
        <Alert
          severity="info"
          sx={{ maxWidth: 700, width: "100%" }}
          action={
            <Stack direction="row" sx={{ gap: 1 }}>
              <Button color="inherit" size="small" component={Link} href="/" onClick={() => void backToProjects()}>
                Projects
              </Button>
              <Button color="inherit" size="small" onClick={() => void takeOverProject()}>
                Use it here
              </Button>
            </Stack>
          }
        >
          {activeProject.name} is open in another tab.
        </Alert>
      </Stack>
    );
  }

  if (status === "failed" && activeProject?.id === projectId) {
    return (
      <Stack sx={{ alignItems: "center", py: 6, px: 2 }}>
        <Alert
          severity="error"
          sx={{ maxWidth: 700, width: "100%" }}
          action={
            <Stack direction="row" sx={{ gap: 1 }}>
              {!storage.singleProject && (
                <Button color="inherit" size="small" component={Link} href="/" onClick={() => void backToProjects()}>
                  Projects
                </Button>
              )}
              <Button
                color="inherit"
                size="small"
                onClick={() => void selectProject(activeProject.id, activeProject.name)}
              >
                Try again
              </Button>
            </Stack>
          }
        >
          <AlertTitle>{activeProject.name} could not be opened</AlertTitle>
          {persistenceError}
        </Alert>
      </Stack>
    );
  }

  if (
    status !== "ready" ||
    !activeProject ||
    activeProject.id !== projectId
  ) {
    return null; // Return null while loading to avoid flashing the selector or empty state
  }

  return (
    <>
      {persistenceError && (
        <PersistentAlert severity="warning" onClose={clearPersistenceError}>
          {persistenceError}
        </PersistentAlert>
      )}
      <AppBar
        position="fixed"
        elevation={0}
        color="inherit"
        sx={{ borderBottom: 1, borderColor: "divider" }}
      >
        <Toolbar disableGutters sx={{ px: { xs: 2, md: 3 }, gap: 1.5 }}>
          {!storage.singleProject && (
            <Button
              component={Link}
              href="/"
              variant="text"
              startIcon={<ArrowBack />}
              onClick={backToProjects}
            >
              Projects
            </Button>
          )}
        <ProjectActionsMenu onShowModules={openModules} />
        <Stack direction="row" sx={{ flexGrow: 1, alignItems: "center", gap: 1, minWidth: 0 }}>
          <Typography variant="h6" noWrap>
            {activeProject.name}
          </Typography>
          {modulesEnabled && activeModuleName != null ? (
            <Button variant="text" color="inherit" onClick={openModules} sx={{ textTransform: "none", minWidth: 0 }}>
              <Typography variant="h6" component="span" color="text.secondary" noWrap>
                / {activeModuleName}
              </Typography>
            </Button>
          ) : null}
        </Stack>
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
          }}
        >
          <Box sx={{ flexGrow: 1, minHeight: 0, minWidth: 0, display: "flex" }}>
            <Suspense fallback={null}>
              <Factory />
            </Suspense>
          </Box>
        </Box>
      </Stack>
      <OutsideChangeDialog />
      <ModuleSwitcherDialog open={modulesOpen} onClose={closeModules} />
    </>
  );
}

const ProjectPage = observer(Home);

/** The project named in the query; the query is read on the client, under a suspense boundary. */
export default function ProjectRoute() {
  return (
    <Suspense fallback={null}>
      <ProjectPage />
    </Suspense>
  );
}
