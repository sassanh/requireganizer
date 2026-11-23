import {
  Add,
  Delete,
  FolderOpen,
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
import { getUserFacingErrorMessage } from "lib/errors";
import { hasProjectName, type ProjectMeta } from "lib/projectStorage";
import { projectHref } from "lib/routes";
import { useProject } from "projectContext";

interface ProjectSelectorProps {
  onSelect: (id: string, name: string) => void;
}

export default function ProjectSelector({ onSelect }: ProjectSelectorProps) {
  const { activeProject, persistence, storage, createProject, importNewProject, deleteProject } = useProject();
  const [projects, setProjects] = useState<ProjectMeta[] | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newName, setNewName] = useState("");
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

  /** Run a creation, then open the project it made. */
  const createThen = async (create: () => Promise<{ id: string; name: string }>, failure: string) => {
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      const created = await create();
      setProjects(await persistence.projects.list());
      setDialogOpen(false);
      setNewName("");
      setError(null);
      onSelect(created.id, created.name);
    } catch (creationError) {
      console.error(failure, creationError);
      setError(creationError instanceof Error ? creationError.message : failure);
    } finally {
      savingRef.current = false;
    }
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name || projects == null || hasProjectName(projectList, name)) return;
    await createThen(() => createProject(name), `The project could not be saved in ${persistence.traits.name}.`);
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteProject(id);
      setProjects((current) =>
        (current ?? []).filter((project) => project.id !== id),
      );
      setProjectToDelete(null);
      setError(null);
    } catch (storageError) {
      console.error("Could not delete project.", storageError);
      setError(getUserFacingErrorMessage(storageError, `The project could not be deleted from ${persistence.traits.name}.`));
    }
  };

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    await createThen(
      async () => importNewProject(await file.text(), file.name),
      `${file.name} was not imported, and nothing changed. Try again.`,
    );
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
      </Stack>

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
                void handleCreate();
              }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => void handleCreate()}
            disabled={!newName.trim() || hasProjectName(projectList, newName.trim())}
          >
            Create
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
