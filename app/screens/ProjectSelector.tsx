import {
  Add,
  Delete,
  FolderOpen,
  Settings,
  Upload,
} from "@mui/icons-material";
import {
  Button,
  Card,
  CardActions,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { observer } from "mobx-react-lite";
import Link from "next/link";
import { ChangeEvent, useEffect, useRef, useState } from "react";

import { PersistentAlert } from "components";
import AiSettingsDialog from "components/AiSettingsDialog";
import { PROJECT_HOST_LOCATION } from "deployment";
import { parseJson } from "lib/json";
import { parseProjectPayload, pickActiveModule } from "lib/moduleSchema";
import { ProjectMeta } from "lib/projectStorage";
import { projectHref } from "lib/routes";
import type { ProjectDeleteResult } from "persistence";
import { useProject } from "projectContext";
import { createModuleStore } from "store";

interface ProjectSelectorProps {
  onSelect: (id: string, name: string, options?: { overviewSeed?: string }) => void;
}

function hasProjectName(projects: ProjectMeta[], name: string): boolean {
  return projects.some(
    (project) => project.name.localeCompare(name, undefined, { sensitivity: "base" }) === 0,
  );
}

export default function ProjectSelector({ onSelect }: ProjectSelectorProps) {
  const { activeProject, persistence, storage } = useProject();
  const [projects, setProjects] = useState<ProjectMeta[] | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [overviewSeed, setOverviewSeed] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [projectToDelete, setProjectToDelete] = useState<ProjectMeta | null>(
    null,
  );
  const importInputRef = useRef<HTMLInputElement>(null);
  // Create and import await storage; a second submit meanwhile would pass
  // the duplicate-name check against the not-yet-updated list.
  const savingRef = useRef(false);
  const projectList = projects ?? [];

  useEffect(() => {
    // Browser storage is unavailable during server rendering. Loading it after
    // hydration keeps the initial markup deterministic.
    let cancelled = false;
    void persistence.projects.list().then((storedProjects) => {
      if (!cancelled) setProjects(storedProjects);
    });
    return () => {
      cancelled = true;
    };
  }, [persistence]);

  // A storage that holds one project opens it in the host; the page follows.
  const onlyProject = storage.singleProject ? activeProject : null;
  const openedOnlyProjectRef = useRef(false);
  useEffect(() => {
    if (onlyProject == null || openedOnlyProjectRef.current) return;
    openedOnlyProjectRef.current = true;
    onSelect(onlyProject.id, onlyProject.name);
  }, [onlyProject, onSelect]);

  const handleCreate = async (draftOverview: boolean) => {
    const name = newName.trim();
    if (!name || projects == null || hasProjectName(projectList, name)) return;
    const seed = overviewSeed.trim();
    if (draftOverview && seed.length === 0) return;

    const id = crypto.randomUUID();
    const meta: ProjectMeta = {
      id,
      name,
      description: "",
      updatedAt: new Date().toISOString(),
    };
    const updatedProjects = [...projectList, meta];

    if (savingRef.current) return;
    savingRef.current = true;
    try {
      await persistence.projects.saveIndex(updatedProjects);
      setProjects(updatedProjects);
      setDialogOpen(false);
      setNewName("");
      setOverviewSeed("");
      setError(null);
      onSelect(id, name, draftOverview ? { overviewSeed: seed } : undefined);
    } catch (storageError) {
      console.error("Could not create project.", storageError);
      setError(`The project could not be saved in ${persistence.traits.name}.`);
    } finally {
      savingRef.current = false;
    }
  };

  const handleDelete = async (id: string) => {
    let result: ProjectDeleteResult;
    try {
      result = await persistence.projects.delete(id);
      setProjects((current) =>
        (current ?? []).filter((project) => project.id !== id),
      );
      setProjectToDelete(null);
      setError(null);
    } catch (storageError) {
      console.error("Could not delete project.", storageError);
      setError(`The project could not be deleted from ${persistence.traits.name}.`);
      return;
    }

    // Revision cleanup failures are only logged by the adapter.
    if (result.unremoved.includes("providerCalls")) {
      setError(
        `The project was deleted, but its AI provider activity could not be removed from ${persistence.traits.name}.`,
      );
    }
  };

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || savingRef.current) return;

    savingRef.current = true;
    try {
      const data = parseJson(await file.text(), "Imported project");
      const payload = parseProjectPayload(data);
      const activeEntry = pickActiveModule(payload);
      const activeStore = createModuleStore(activeEntry.snapshot);
      // Every other module passes the same validation gate before its
      // bytes are stored; the payload itself is saved unchanged.
      for (const entry of payload.modules) {
        if (entry.id !== activeEntry.id) createModuleStore(entry.snapshot);
      }

      const baseName =
        activeStore.productOverview.name?.trim() ||
        file.name.replace(/\.json$/i, "");
      let name = baseName;
      let suffix = 1;
      while (hasProjectName(projectList, name)) {
        name = `${baseName} (${suffix})`;
        suffix += 1;
      }

      const id = crypto.randomUUID();
      const meta: ProjectMeta = {
        id,
        name,
        description: activeStore.productOverview.purpose?.slice(0, 200) ?? "",
        updatedAt: new Date().toISOString(),
      };

      const updatedProjects = [...projectList, meta];
      await persistence.projects.saveBundle(id, payload, updatedProjects);
      setProjects(updatedProjects);
      setError(null);
      onSelect(id, name);
    } catch (importError) {
      console.error("Could not import project.", importError);
      setError(
        importError instanceof Error
          ? importError.message
          : "The selected file is not a valid Requireganizer project.",
      );
    } finally {
      savingRef.current = false;
    }
  };

  if (onlyProject != null) return null;

  return (
    <Stack
      sx={{
        alignItems: "center",
        py: 6,
        gap: 4,
        maxWidth: 700,
        mx: "auto",
      }}
    >
      <Typography variant="h3">Requireganizer</Typography>
      <Typography variant="body1" sx={{ color: "text.secondary" }}>
        {storage.singleProject
          ? `Create the project ${storage.name} will hold, or import one.`
          : "Select a project to continue, or create a new one."}
      </Typography>

      {error && (
        <PersistentAlert severity="error" onClose={() => setError(null)}>
          {error}
        </PersistentAlert>
      )}

      <Stack sx={{ gap: 2, width: "100%" }}>
        {projectList.map((project) => (
          <Card key={project.id} variant="outlined">
            <CardContent>
              <Typography variant="h6">{project.name}</Typography>
              {project.description && (
                <Typography
                  variant="body2"
                  sx={{
                    color: "text.secondary",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {project.description}
                </Typography>
              )}
              <Typography variant="caption" sx={{ color: "text.disabled" }}>
                Last updated: {new Date(project.updatedAt).toLocaleString()}
              </Typography>
            </CardContent>
            <CardActions>
              <Button
                component={Link}
                href={projectHref(project.id)}
                startIcon={<FolderOpen />}
                onClick={() => onSelect(project.id, project.name)}
              >
                Open
              </Button>
              {!storage.singleProject && (
                <IconButton
                  size="small"
                  color="error"
                  aria-label={`Delete ${project.name}`}
                  onClick={() => setProjectToDelete(project)}
                  sx={{ ml: "auto" }}
                >
                  <Delete />
                </IconButton>
              )}
            </CardActions>
          </Card>
        ))}

        {projects === null ? (
          <Typography
            variant="body1"
            sx={{ color: "text.secondary", textAlign: "center", py: 4 }}
          >
            Loading projects…
          </Typography>
        ) : projects.length === 0 && !storage.singleProject ? (
          <Typography
            variant="body1"
            sx={{ color: "text.secondary", textAlign: "center", py: 4 }}
          >
            No projects yet. Create one to get started.
          </Typography>
        ) : null}
      </Stack>

      <Stack direction="row" sx={{ gap: 2 }}>
        <Button
          variant="contained"
          size="large"
          startIcon={<Add />}
          disabled={projects === null}
          onClick={() => setDialogOpen(true)}
        >
          New Project
        </Button>
        <Button
          variant="outlined"
          size="large"
          startIcon={<Upload />}
          disabled={projects === null}
          onClick={() => importInputRef.current?.click()}
        >
          Import Project
        </Button>
        <input
          hidden
          ref={importInputRef}
          type="file"
          accept=".json,application/json"
          onChange={handleImport}
        />
        {PROJECT_HOST_LOCATION === "page" && (
          <Button
            size="large"
            startIcon={<Settings />}
            onClick={() => setAiSettingsOpen(true)}
          >
            AI settings
          </Button>
        )}
      </Stack>

      <AiSettingsDialog open={aiSettingsOpen} onClose={() => setAiSettingsOpen(false)} />

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>New Project</DialogTitle>
        <DialogContent>
          <Stack sx={{ gap: 2, mt: 1 }}>
            <TextField
              autoFocus
              fullWidth
              error={newName.trim().length > 0 && hasProjectName(projectList, newName.trim())}
              helperText={
                newName.trim().length > 0 && hasProjectName(projectList, newName.trim())
                  ? "A project with this name already exists."
                  : undefined
              }
              label="Project name"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                if (overviewSeed.trim().length > 0) handleCreate(true);
                else handleCreate(false);
              }}
            />
            <TextField
              fullWidth
              multiline
              minRows={3}
              label="Starting intent"
              helperText="Optional. Drafts the product overview once, then is discarded."
              value={overviewSeed}
              onChange={(event) => setOverviewSeed(event.target.value)}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button
            onClick={() => handleCreate(false)}
            disabled={!newName.trim() || hasProjectName(projectList, newName.trim())}
          >
            Skip
          </Button>
          <Button
            variant="contained"
            onClick={() => handleCreate(true)}
            disabled={
              !newName.trim() ||
              hasProjectName(projectList, newName.trim()) ||
              overviewSeed.trim().length === 0
            }
          >
            Draft product overview
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={projectToDelete !== null}
        onClose={() => setProjectToDelete(null)}
      >
        <DialogTitle>Delete project?</DialogTitle>
        <DialogContent>
          <Typography>
            {projectToDelete == null
              ? "This project will be permanently deleted."
              : `“${projectToDelete.name}” and all of its generated data will be permanently deleted.`}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setProjectToDelete(null)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => {
              if (projectToDelete) void handleDelete(projectToDelete.id);
            }}
          >
            Delete Project
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
