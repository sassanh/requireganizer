import {
    ChevronRight,
    ExpandMore,
    InsertDriveFileOutlined,
    FolderOutlined,
} from "@mui/icons-material";
import {
    Collapse,
    List,
    ListItemButton,
    ListItemIcon,
    ListItemText,
    Typography,
} from "@mui/material";
import React, { useMemo, useState } from "react";

export interface TreeNode {
    name: string;
    path: string;
    isFolder: boolean;
    children: Record<string, TreeNode>;
}

interface FileTreeProps {
    files: { path: string; content: string }[];
    selectedFile: string | null;
    onSelectFile: (path: string) => void;
}

const buildTree = (files: { path: string }[]): TreeNode => {
    const root: TreeNode = {
        name: "root",
        path: "",
        isFolder: true,
        children: {},
    };

    files.forEach((file) => {
        const parts = file.path.split("/");
        let current = root;

        parts.forEach((part, index) => {
            if (!current.children[part]) {
                current.children[part] = {
                    name: part,
                    path: parts.slice(0, index + 1).join("/"),
                    isFolder: index < parts.length - 1,
                    children: {},
                };
            }
            current = current.children[part];
        });
    });

    return root;
};

const FileTreeNode = ({
    node,
    selectedFile,
    onSelectFile,
    level = 0,
}: {
    node: TreeNode;
    selectedFile: string | null;
    onSelectFile: (path: string) => void;
    level?: number;
}) => {
    const [open, setOpen] = useState(true);

    const isSelected = selectedFile === node.path;
    const paddingLeft = level * 16 + 16;

    const handleClick = () => {
        if (node.isFolder) {
            setOpen(!open);
        } else {
            onSelectFile(node.path);
        }
    };

    // Sort folders first, then alphabetically
    const sortedChildren = useMemo(() => {
        return Object.values(node.children).sort((a, b) => {
            if (a.isFolder === b.isFolder) {
                return a.name.localeCompare(b.name);
            }
            return a.isFolder ? -1 : 1;
        });
    }, [node.children]);

    return (
        <>
            <ListItemButton
                onClick={handleClick}
                selected={isSelected}
                sx={{
                    pl: `${paddingLeft}px`,
                    py: 0.5,
                    minHeight: 32,
                }}
            >
                <ListItemIcon sx={{ minWidth: 28 }}>
                    {node.isFolder ? (
                        open ? (
                            <ExpandMore fontSize="small" color="action" />
                        ) : (
                            <ChevronRight fontSize="small" color="action" />
                        )
                    ) : (
                        <InsertDriveFileOutlined fontSize="small" color="action" sx={{ ml: 0.5 }} />
                    )}
                </ListItemIcon>
                {node.isFolder && (
                    <ListItemIcon sx={{ minWidth: 28 }}>
                        <FolderOutlined fontSize="small" color={open ? "primary" : "action"} />
                    </ListItemIcon>
                )}
                <ListItemText
                    primary={
                        <Typography variant="body2" sx={{ fontFamily: "monospace", fontSize: "0.85rem" }}>
                            {node.name}
                        </Typography>
                    }
                />
            </ListItemButton>
            {node.isFolder && (
                <Collapse in={open} timeout="auto" unmountOnExit>
                    <List component="div" disablePadding>
                        {sortedChildren.map((child) => (
                            <FileTreeNode
                                key={child.path}
                                node={child}
                                selectedFile={selectedFile}
                                onSelectFile={onSelectFile}
                                level={level + 1}
                            />
                        ))}
                    </List>
                </Collapse>
            )}
        </>
    );
};

export const FileTree = ({ files, selectedFile, onSelectFile }: FileTreeProps) => {
    const tree = useMemo(() => buildTree(files), [files]);

    // Sort root children
    const sortedRootChildren = useMemo(() => {
        return Object.values(tree.children).sort((a, b) => {
            if (a.isFolder === b.isFolder) {
                return a.name.localeCompare(b.name);
            }
            return a.isFolder ? -1 : 1;
        });
    }, [tree.children]);

    if (files.length === 0) {
        return (
            <Typography variant="body2" color="text.secondary" sx={{ p: 2, fontStyle: "italic" }}>
                No files generated yet.
            </Typography>
        );
    }

    return (
        <List
            component="nav"
            dense
            sx={{
                width: "100%",
                bgcolor: "background.paper",
                overflowY: "auto",
                overflowX: "hidden",
            }}
        >
            {sortedRootChildren.map((child) => (
                <FileTreeNode
                    key={child.path}
                    node={child}
                    selectedFile={selectedFile}
                    onSelectFile={onSelectFile}
                    level={0}
                />
            ))}
        </List>
    );
};

export default FileTree;
