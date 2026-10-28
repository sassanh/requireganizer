"use client";

import { ArrowBack, Code } from "@mui/icons-material";
import {
    Box,
    Button,
    Divider,
    Stack,
    Typography,
} from "@mui/material";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, Suspense } from "react";

import { CodeBlock, FileTree } from "components";
import {
    readStoredProjectView,
    StoredProjectView,
} from "lib/projectStorage";
import { projectCodeHref } from "lib/routes";
import { usePersistence } from "projectContext";

const EMPTY_PROJECT_VIEW: StoredProjectView = {
    name: "",
    scaffoldFiles: [],
};

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

function CodeViewerContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const persistence = usePersistence();
    const projectId = searchParams.get("id") ?? "";

    const [projectView, setProjectView] = useState<StoredProjectView | null>(null);
    const requestRef = useRef(0);
    const { name: projectName, scaffoldFiles: files } =
        projectView ?? EMPTY_PROJECT_VIEW;

    const selectedFile = searchParams.get("path");


    const reloadData = useCallback(() => {
        if (!projectId) return;
        const request = requestRef.current + 1;
        requestRef.current = request;
        void Promise.all([persistence.projects.list(), persistence.projects.load(projectId)]).then(([projects, data]) => {
            if (request !== requestRef.current) return;
            const name = projects.find(({ id }) => id === projectId)?.name ?? "";
            setProjectView(readStoredProjectView(data, name) ?? EMPTY_PROJECT_VIEW);
        });
    }, [persistence, projectId]);

    useEffect(() => {
        // Browser storage is unavailable during server rendering.
        reloadData();
    }, [reloadData]);

    useEffect(() => {
        // Browser storage reports another tab's save; a project server's
        // changes show when this tab is looked at again.
        const handleStorageChange = (e: StorageEvent) => {
            if (e.key === `requireganizer:project:${projectId}`) {
                reloadData();
            }
        };

        window.addEventListener("storage", handleStorageChange);
        window.addEventListener("focus", reloadData);
        return () => {
            window.removeEventListener("storage", handleStorageChange);
            window.removeEventListener("focus", reloadData);
        };
    }, [projectId, reloadData]);

    useEffect(() => {
        if (files.length > 0 && !selectedFile) {
            router.replace(projectCodeHref(projectId, files[0].path));
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
                }}>— Project Files</Typography>
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
                        Project filesystem
                    </Typography>
                    <Divider />
                    <Box sx={{ flexGrow: 1, overflowY: "auto" }}>
                        <FileTree
                            files={files}
                            selectedFile={selectedFile}
                            onSelectFile={(path) => router.push(projectCodeHref(projectId, path))}
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
        }}>Loading Project Files...</Box>}>
            <CodeViewerContent />
        </Suspense>
    );
}
