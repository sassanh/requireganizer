"use client";

import { Box, Typography } from "@mui/material";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const listSx = { my: 0.5, pl: 3, ml: 0, listStylePosition: "outside", minWidth: 0 } as const;

/** A thread message's text, rendered as Markdown. */
export default function MessageText({ text }: { text: string }) {
  return (
    <Box sx={{ "& > :first-of-type": { mt: 0 }, "& > :last-child": { mb: 0 } }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <Typography variant="body2" sx={{ my: 1 }}>{children}</Typography>,
          // The app-wide CSS reset removes list indentation; without these
          // the outside-positioned markers overflow or misalign.
          ul: ({ children }) => <Box component="ul" sx={{ ...listSx, listStyleType: "disc" }}>{children}</Box>,
          ol: ({ children }) => <Box component="ol" sx={{ ...listSx, listStyleType: "decimal" }}>{children}</Box>,
          li: ({ children }) => <Typography component="li" variant="body2" sx={{ display: "list-item", my: 0.5 }}>{children}</Typography>,
          hr: () => <Box component="hr" sx={{ my: 1, border: "none", borderTop: 1, borderColor: "divider" }} />,
          code: ({ children }) => (
            <Box component="code" sx={{ fontFamily: "monospace", fontSize: 12, px: 0.5, borderRadius: 0.5, bgcolor: (theme) => theme.alpha(theme.vars.palette.text.primary, 0.08) }}>
              {children}
            </Box>
          ),
          pre: ({ children }) => (
            <Box component="pre" sx={{ m: 0, p: 1, overflowX: "auto", borderRadius: 1, fontSize: 12, bgcolor: (theme) => theme.alpha(theme.vars.palette.text.primary, 0.06) }}>
              {children}
            </Box>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </Box>
  );
}
