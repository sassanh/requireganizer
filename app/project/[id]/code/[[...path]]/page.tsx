"use client";

import { ArrowBack, Code } from "@mui/icons-material";
import {
    Box,
    Button,
    Divider,
    Stack,
    Typography,
} from "@mui/material";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, Suspense } from "react";

import { CodeBlock, FileTree } from "components";
import {
    loadProjectData,
    readStoredProjectView,
    StoredProjectView,
} from "lib/projectStorage";

const EMPTY_PROJECT_VIEW: StoredProjectView = {
    name: "",
    scaffoldFiles: [],
};

function loadProjectView(projectId: string): StoredProjectView {
    return readStoredProjectView(loadProjectData(projectId)) ?? EMPTY_PROJECT_VIEW;
}

function getCodeLanguage(path: string): string {
    const extension = path.split(".").pop()?.toLowerCase();
    switch (extension) {
        case "ts":
        case "tsx":
            return "typescript";
        case "js":
        case "jsx":
            return "javascript";
        case "json":
            return "json";
        case "md":
            return "markdown";
        case "html":
            return "html";
        case "css":
            return "css";
        case "yml":
        case "yaml":
            return "yaml";
        case "sh":
            return "bash";
        case "py":
            return "python";
        case "rs":
            return "rust";
        case "go":
            return "go";
        default:
            return "text";
    }
}

function getFileHref(projectId: string, path: string): string {
    const encodedPath = path.split("/").map(encodeURIComponent).join("/");
    return `/project/${encodeURIComponent(projectId)}/code/${encodedPath}`;
}

function CodeViewerContent() {
    const params = useParams();
    const router = useRouter();
    const projectId = params?.id as string;
    const pathArray = params?.path as string[] | undefined;

    const [projectView, setProjectView] = useState<StoredProjectView | null>(null);
    const { name: projectName, scaffoldFiles: files } =
        projectView ?? EMPTY_PROJECT_VIEW;

    const selectedFile = pathArray ? pathArray.join("/") : null;


    const reloadData = useCallback(() => {
        if (!projectId) return;
        setProjectView(loadProjectView(projectId));
    }, [projectId]);

    useEffect(() => {
        // Browser storage is unavailable during server rendering.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        reloadData();
    }, [reloadData]);

    useEffect(() => {
        // Listen to localStorage changes across tabs
        const handleStorageChange = (e: StorageEvent) => {
            if (e.key === `requireganizer:project:${projectId}`) {
                reloadData();
            }
        };

        window.addEventListener("storage", handleStorageChange);
        return () => window.removeEventListener("storage", handleStorageChange);
    }, [projectId, reloadData]);

    useEffect(() => {
        if (files.length > 0 && !selectedFile) {
            router.replace(getFileHref(projectId, files[0].path));
        }
    }, [files, selectedFile, projectId, router]);

    if (projectView == null) {
        return <Box sx={{ p: 3 }}>Loading code viewer…</Box>;
    }

    if (!projectId || (files.length === 0 && !projectName)) {
        return (
            <Box sx={{
                p: 3
            }}>
                <Typography color="error">Project not found.</Typography>
            </Box>
        );
    }

    const selectedFileContent = files.find((f) => f.path === selectedFile)?.content || "";

    return (
        <Stack direction="column" sx={{ height: "100vh", overflow: "hidden" }}>
            {/* Top Bar */}
            <Stack
                direction="row"
                sx={{
                    alignItems: "center",
                    gap: 2,
                    px: 2,
                    py: 1,
                    borderBottom: "1px solid",
                    borderColor: "divider",
                    bgcolor: "background.paper"
                }}>
                <Typography variant="h6" sx={{ flexGrow: 1, display: "flex", alignItems: "center", gap: 1 }}>
                    <Code /> {projectName} <Typography variant="caption" sx={{
                    color: "text.secondary"
                }}>— Code Viewer</Typography>
                </Typography>
                <Button
                    variant="outlined"
                    color="inherit"
                    startIcon={<ArrowBack />}
                    onClick={() => window.close()}
                    size="small"
                >
                    Close Tab
                </Button>
            </Stack>

            {/* Main Content Split */}
            <Stack direction="row" sx={{ flexGrow: 1, overflow: "hidden" }}>
                {/* Sidebar: File Tree */}
                <Box
                    sx={{
                        width: 280,
                        flexShrink: 0,
                        borderRight: "1px solid",
                        borderColor: "divider",
                        bgcolor: "background.paper",
                        display: "flex",
                        flexDirection: "column",
                    }}
                >
                    <Typography variant="overline" sx={{ px: 2, py: 1, fontWeight: "bold", bgcolor: "action.hover" }}>
                        Virtual Filesystem
                    </Typography>
                    <Divider />
                    <Box sx={{ flexGrow: 1, overflowY: "auto" }}>
                        <FileTree
                            files={files}
                            selectedFile={selectedFile}
                            onSelectFile={(path) => router.push(getFileHref(projectId, path))}
                        />
                    </Box>
                </Box>

                {/* Main Panel: Code Block */}
                <Box sx={{ flexGrow: 1, display: "flex", flexDirection: "column", overflow: "hidden", bgcolor: "#1e1e1e" }}>
                    {selectedFile ? (
                        <>
                            {/* File Header Tab */}
                            <Stack
                                direction="row"
                                sx={{
                                    bgcolor: "#2d2d2d",
                                    color: "#ccc",
                                    px: 2,
                                    py: 1,
                                    fontFamily: "monospace",
                                    fontSize: "0.875rem",
                                    borderBottom: "1px solid #111",
                                }}
                            >
                                {selectedFile}
                            </Stack>
                            <Box sx={{ flexGrow: 1, overflowY: "auto", p: 2 }}>
                                <CodeBlock
                                    code={selectedFileContent}
                                    language={getCodeLanguage(selectedFile)}
                                />
                            </Box>
                        </>
                    ) : (
                        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "text.secondary" }}>
                            <Typography>Select a file to view its code.</Typography>
                        </Box>
                    )}
                </Box>
            </Stack>
        </Stack>
    );
}

export default function CodeViewerPage() {
    return (
        <Suspense fallback={<Box sx={{
            p: 3
        }}>Loading Code Viewer...</Box>}>
            <CodeViewerContent />
        </Suspense>
    );
}
