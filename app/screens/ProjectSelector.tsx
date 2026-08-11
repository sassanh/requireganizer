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
import React, { useRef, useState } from "react";

import { Store } from "store";

const PROJECTS_INDEX_KEY = "requireganizer:projects";

export interface ProjectMeta {
    id: string; // UUID
    name: string;
    description: string;
    updatedAt: string;
}

export function getProjectsIndex(): ProjectMeta[] {
    if (typeof window === "undefined") return [];
    try {
        const raw = localStorage.getItem(PROJECTS_INDEX_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

export function saveProjectsIndex(projects: ProjectMeta[]) {
    localStorage.setItem(PROJECTS_INDEX_KEY, JSON.stringify(projects));
}

export function getProjectStorageKey(id: string) {
    return `requireganizer:project:${id}`;
}

export function loadProjectData(id: string): Record<string, unknown> | null {
    try {
        const raw = localStorage.getItem(getProjectStorageKey(id));
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

export function saveProjectData(id: string, data: unknown) {
    localStorage.setItem(getProjectStorageKey(id), JSON.stringify(data));
}

export function deleteProjectData(id: string) {
    localStorage.removeItem(getProjectStorageKey(id));
    const projects = getProjectsIndex().filter((p) => p.id !== id);
    saveProjectsIndex(projects);
}

interface ProjectSelectorProps {
    onSelect: (id: string, name: string) => void;
}

const ProjectSelector: React.FunctionComponent<ProjectSelectorProps> = ({
    onSelect,
}) => {
    const [projects, setProjects] = useState<ProjectMeta[]>(getProjectsIndex);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [newName, setNewName] = useState("");
    const importInputRef = useRef<HTMLInputElement>(null);

    const handleCreate = () => {
        const name = newName.trim();
        if (!name) return;

        const existing = projects.find((p) => p.name === name);
        if (existing) return;

        const id = crypto.randomUUID();

        const meta: ProjectMeta = {
            id,
            name,
            description: "",
            updatedAt: new Date().toISOString(),
        };
        const updated = [...projects, meta];
        saveProjectsIndex(updated);
        setProjects(updated);
        setDialogOpen(false);
        setNewName("");
        onSelect(id, name);
    };

    const handleDelete = (id: string) => {
        deleteProjectData(id);
        setProjects(getProjectsIndex());
    };

    const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target?.result as string);
                const name =
                    data.productOverview?.name ||
                    file.name.replace(/\.json$/i, "");

                // Avoid duplicates by appending a number
                let finalName = name;
                let counter = 1;
                while (projects.find((p) => p.name === finalName)) {
                    finalName = `${name} (${counter++})`;
                }

                const id = crypto.randomUUID();

                const meta: ProjectMeta = {
                    id,
                    name: finalName,
                    description: data.description?.slice(0, 200) ?? "",
                    updatedAt: new Date().toISOString(),
                };

                // Create a temporary store and use the import action to properly
                // hydrate it, then save the full MST snapshot to localStorage
                const tempStore = Store.create({ productOverview: {} });
                tempStore.import(data);
                saveProjectData(id, getSnapshot(tempStore));

                const updated = [...projects, meta];
                saveProjectsIndex(updated);
                setProjects(updated);
                onSelect(id, finalName);
            } catch (error) {
                console.error("Error importing project:", error);
            }
        };
        reader.readAsText(file);

        if (importInputRef.current) importInputRef.current.value = "";
    };

    return (
        <Stack
            sx={{
                alignItems: "center",
                py: 6,
                gap: 4,
                maxWidth: 700,
                mx: "auto"
            }}>
            <Typography variant="h3">Requireganizer</Typography>
            <Typography variant="body1" sx={{
                color: "text.secondary"
            }}>
                Select a project to continue, or create a new one.
            </Typography>

            <Stack
                sx={{
                    gap: 2,
                    width: "100%"
                }}>
                {projects.map((project) => (
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
                                        whiteSpace: "nowrap"
                                    }}>
                                    {project.description}
                                </Typography>
                            )}
                            <Typography variant="caption" sx={{
                                color: "text.disabled"
                            }}>
                                Last updated: {new Date(project.updatedAt).toLocaleString()}
                            </Typography>
                        </CardContent>
                        <CardActions>
                            <Button
                                component={Link}
                                href={`/project/${project.id}`}
                                startIcon={<FolderOpen />}
                                onClick={() => onSelect(project.id, project.name)}
                            >
                                Open
                            </Button>
                            <IconButton
                                size="small"
                                color="error"
                                onClick={() => handleDelete(project.id)}
                                sx={{ ml: "auto" }}
                            >
                                <Delete />
                            </IconButton>
                        </CardActions>
                    </Card>
                ))}

                {projects.length === 0 && (
                    <Typography
                        variant="body1"
                        sx={{
                            color: "text.secondary",
                            textAlign: "center",
                            py: 4
                        }}>
                        No projects yet. Create one to get started.
                    </Typography>
                )}
            </Stack>

            <Stack direction="row" sx={{
                gap: 2
            }}>
                <Button
                    variant="contained"
                    size="large"
                    startIcon={<Add />}
                    onClick={() => setDialogOpen(true)}
                >
                    New Project
                </Button>
                <Button
                    variant="outlined"
                    size="large"
                    startIcon={<Upload />}
                    onClick={() => importInputRef.current?.click()}
                >
                    Import Project
                </Button>
                <input
                    hidden
                    ref={importInputRef}
                    type="file"
                    accept=".json"
                    onChange={handleImport}
                />
            </Stack>

            <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)}>
                <DialogTitle>New Project</DialogTitle>
                <DialogContent>
                    <TextField
                        autoFocus
                        fullWidth
                        label="Project Name"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                        sx={{ mt: 1 }}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
                    <Button
                        variant="contained"
                        onClick={handleCreate}
                        disabled={!newName.trim()}
                    >
                        Create
                    </Button>
                </DialogActions>
            </Dialog>
        </Stack>
    );
};

export default ProjectSelector;
