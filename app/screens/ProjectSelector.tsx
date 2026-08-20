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
import { getSnapshot } from "mobx-state-tree";
import Link from "next/link";
import { ChangeEvent, useEffect, useRef, useState } from "react";

import { PersistentAlert } from "components";
import { parseJson } from "lib/json";
import {
  deleteProjectData,
  getProjectsIndex,
  ProjectMeta,
  saveProjectBundle,
  saveProjectsIndex,
} from "lib/projectStorage";
import { deleteProviderCallsForProject } from "lib/providerCallStorage";
import { Store } from "store";

interface ProjectSelectorProps {
  onSelect: (id: string, name: string) => void;
}

function hasProjectName(projects: ProjectMeta[], name: string): boolean {
  return projects.some(
    (project) => project.name.localeCompare(name, undefined, { sensitivity: "base" }) === 0,
  );
}

export default function ProjectSelector({ onSelect }: ProjectSelectorProps) {
  const [projects, setProjects] = useState<ProjectMeta[] | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [projectToDelete, setProjectToDelete] = useState<ProjectMeta | null>(
    null,
  );
  const importInputRef = useRef<HTMLInputElement>(null);
  const projectList = projects ?? [];

  useEffect(() => {
    // Browser storage is unavailable during server rendering. Loading it after
    // hydration keeps the initial markup deterministic.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProjects(getProjectsIndex());
  }, []);

  const handleCreate = () => {
    const name = newName.trim();
    if (!name || projects == null || hasProjectName(projectList, name)) return;

    const id = crypto.randomUUID();
    const meta: ProjectMeta = {
      id,
      name,
      description: "",
      updatedAt: new Date().toISOString(),
    };
    const updatedProjects = [...projectList, meta];

    try {
      saveProjectsIndex(updatedProjects);
      setProjects(updatedProjects);
      setDialogOpen(false);
      setNewName("");
      setError(null);
      onSelect(id, name);
    } catch (storageError) {
      console.error("Could not create project.", storageError);
      setError("The project could not be saved in browser storage.");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      deleteProjectData(id);
      setProjects((current) =>
        (current ?? []).filter((project) => project.id !== id),
      );
      setProjectToDelete(null);
      setError(null);
    } catch (storageError) {
      console.error("Could not delete project.", storageError);
      setError("The project could not be deleted from browser storage.");
      return;
    }

    try {
      await deleteProviderCallsForProject(id);
    } catch (storageError) {
      console.error("Could not delete the project's provider activity.", storageError);
      setError(
        "The project was deleted, but its AI provider activity could not be removed from browser storage.",
      );
    }
  };

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      const data = parseJson(await file.text(), "Imported project");
      const importedStore = Store.create({ productOverview: {} });
      importedStore.import(data);

      const baseName =
        importedStore.productOverview.name?.trim() ||
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
        description: importedStore.description.slice(0, 200),
        updatedAt: new Date().toISOString(),
      };

      const updatedProjects = [...projectList, meta];
      saveProjectBundle(id, getSnapshot(importedStore), updatedProjects);
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
    }
  };

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
        Select a project to continue, or create a new one.
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
                href={`/project/${encodeURIComponent(project.id)}`}
                startIcon={<FolderOpen />}
                onClick={() => onSelect(project.id, project.name)}
              >
                Open
              </Button>
              <IconButton
                size="small"
                color="error"
                aria-label={`Delete ${project.name}`}
                onClick={() => setProjectToDelete(project)}
                sx={{ ml: "auto" }}
              >
                <Delete />
              </IconButton>
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
        ) : projects.length === 0 ? (
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

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)}>
        <DialogTitle>New Project</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            error={newName.trim().length > 0 && hasProjectName(projectList, newName.trim())}
            helperText={
              newName.trim().length > 0 && hasProjectName(projectList, newName.trim())
                ? "A project with this name already exists."
                : undefined
            }
            label="Project Name"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && handleCreate()}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleCreate}
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
