import { Box, Skeleton } from "@mui/material";
import { useEffect, useState } from "react";
import { codeToHtml } from "shiki";

interface CodeBlockProps {
    code: string;
    language?: string;
}

const CodeBlock = ({ code, language = "typescript" }: CodeBlockProps) => {
    const [html, setHtml] = useState<string | null>(null);

    useEffect(() => {
        let isMounted = true;

        // Fallback to text if language isn't matched easily
        const safeLanguage = language.toLowerCase().replace(/[^a-z0-9-]/g, "");

        codeToHtml(code, {
            lang: safeLanguage || "text",
            theme: "vitesse-dark",
        })
            .then((result) => {
                if (isMounted) {
                    setHtml(result);
                }
            })
            .catch((error) => {
                console.error("Failed to highlight code with Shiki:", error);
                // Fallback to simple pre on failure
                if (isMounted) {
                    setHtml(`<pre><code>${code.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</code></pre>`);
                }
            });

        return () => {
            isMounted = false;
        };
    }, [code, language]);

    if (!html) {
        return <Skeleton variant="rectangular" width="100%" height={200} />;
    }

    return (
        <Box
            sx={{
                "& pre": {
                    p: 2,
                    m: 0,
                    borderRadius: 1,
                    overflowX: "auto",
                    fontFamily: "monospace",
                    fontSize: "0.875rem",
                    border: "1px solid",
                    borderColor: "divider",
                },
            }}
            dangerouslySetInnerHTML={{ __html: html }}
        />
    );
};

export default CodeBlock;
