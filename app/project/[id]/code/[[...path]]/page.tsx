"use client";

import { Code } from "@mui/icons-material";

import { ArrowBack } from "@mui/icons-material";
import {
    Box,
    Button,
    Divider,
    Stack,
    Typography,
} from "@mui/material";
import { useEffect, useState, Suspense } from "react";
import { useParams, useRouter } from "next/navigation";

import { CodeBlock, FileTree } from "components";
import { loadProjectData } from "screens/ProjectSelector";

function CodeViewerContent() {
    const params = useParams();
    const router = useRouter();
    const projectId = params?.id as string;
    const pathArray = params?.path as string[] | undefined;

    const [files, setFiles] = useState<{ path: string; content: string }[]>([]);
    const [projectName, setProjectName] = useState<string>("");

    const selectedFile = pathArray ? pathArray.map(decodeURIComponent).join("/") : null;


    const reloadData = () => {
        if (!projectId) return;
        const data = loadProjectData(projectId) as any;
        if (data && data.productOverview) {
            setProjectName(data.productOverview.name || "Unknown Project");
        }
        if (data && data.scaffoldFiles) {
            setFiles(data.scaffoldFiles || []);
        } else {
            setFiles([]);
        }
    };

    useEffect(() => {
        // Initial load
        reloadData();

        // Listen to localStorage changes across tabs
        const handleStorageChange = (e: StorageEvent) => {
            if (e.key === `requireganizer:project:${projectId}`) {
                reloadData();
            }
        };

        window.addEventListener("storage", handleStorageChange);
        return () => window.removeEventListener("storage", handleStorageChange);
    }, [projectId]);

    useEffect(() => {
        if (files.length > 0 && !selectedFile) {
            router.replace(`/project/${projectId}/code/${files[0].path}`);
        }
    }, [files, selectedFile, projectId, router]);

    if (!projectId || files.length === 0 && !projectName) {
        return (
            <Box p={3}>
                <Typography color="error">Project not found or loading.</Typography>
            </Box>
        );
    }

    const selectedFileContent = files.find((f) => f.path === selectedFile)?.content || "";

    // Helper to determine language for CodeBlock based on file extension
    const getLanguage = (path: string) => {
        const ext = path.split(".").pop()?.toLowerCase();
        switch (ext) {
            case "ts":
            case "tsx": return "typescript";
            case "js":
            case "jsx": return "javascript";
            case "json": return "json";
            case "md": return "markdown";
            case "html": return "html";
            case "css": return "css";
            case "yml":
            case "yaml": return "yaml";
            case "sh": return "bash";
            case "py": return "python";
            case "rs": return "rust";
            case "go": return "go";
            default: return "text";
        }
    };

    return (
        <Stack direction="column" sx={{ height: "100vh", overflow: "hidden" }}>
            {/* Top Bar */}
            <Stack
                direction="row"
                alignItems="center"
                gap={2}
                sx={{
                    px: 2,
                    py: 1,
                    borderBottom: "1px solid",
                    borderColor: "divider",
                    bgcolor: "background.paper",
                }}
            >
                <Typography variant="h6" sx={{ flexGrow: 1, display: "flex", alignItems: "center", gap: 1 }}>
                    <Code /> {projectName} <Typography variant="caption" color="text.secondary">— Code Viewer</Typography>
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
                        <FileTree files={files} selectedFile={selectedFile} onSelectFile={(path) => router.push(`/project/${projectId}/code/${path}`)} />
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
                                <CodeBlock code={selectedFileContent} language={getLanguage(selectedFile)} />
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
        <Suspense fallback={<Box p={3}>Loading Code Viewer...</Box>}>
            <CodeViewerContent />
        </Suspense>
    );
}
