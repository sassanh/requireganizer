"use client";

import { Box, Typography } from "@mui/material";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";

import { mentionedItem } from "../threads";
import ItemChip from "./ItemChip";

const listSx = { my: 0.5, pl: 3, ml: 0, listStylePosition: "outside", minWidth: 0 } as const;

/** A marked mention's address is kept as written; every other address as Markdown keeps it. */
function urlTransform(url: string): string {
  return mentionedItem(url) == null ? defaultUrlTransform(url) : url;
}

/** A thread message's text, rendered as Markdown, each marked mention as the item it names. */
export default function MessageText({ text }: { text: string }) {
  return (
    <Box sx={{ "& > :first-of-type": { mt: 0 }, "& > :last-child": { mb: 0 } }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={urlTransform}
        components={{
          // A paragraph is a block, so the chip of a marked mention may sit in it.
          p: ({ children }) => <Typography component="div" variant="body2" sx={{ my: 1 }}>{children}</Typography>,
          a: ({ node: _node, href, children, ...props }) => {
            const itemId = href == null ? null : mentionedItem(href);
            return itemId == null ? <a href={href} {...props}>{children}</a> : <ItemChip itemId={itemId} />;
          },
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
