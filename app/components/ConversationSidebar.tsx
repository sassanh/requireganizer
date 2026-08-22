"use client";

import { ChevronRight, ExpandMore, Forum, Stop } from "@mui/icons-material";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import { observer } from "mobx-react-lite";
import { useEffect, useRef } from "react";

import { useStore } from "store";

type ContentBlock = {
  type: string;
  text?: string;
  thinking?: string;
  name?: string;
};

type ConversationMessage = {
  role: string;
  content: unknown;
  toolName?: string;
  isError?: boolean;
};

function toBlocks(content: unknown): ContentBlock[] {
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }
  return Array.isArray(content) ? (content as ContentBlock[]) : [];
}

function blockText(blocks: ContentBlock[], kind: string): string {
  return blocks
    .filter((block) => block.type === kind)
    .map((block) => block.text ?? block.thinking ?? "")
    .join("");
}

function MessageView({ message }: { message: ConversationMessage }) {
  const blocks = toBlocks(message.content);

  if (message.role === "user") {
    return (
      <Paper variant="outlined" sx={{ p: 1.25 }}>
        <Typography variant="caption" color="text.secondary">You</Typography>
        <Box component="pre" sx={{ m: 0, fontFamily: "monospace", fontSize: 11, whiteSpace: "pre-wrap" }}>
          {blockText(blocks, "text")}
        </Box>
      </Paper>
    );
  }

  if (message.role === "toolResult") {
    return (
      <Stack spacing={0.5}>
        <Chip
          size="small"
          label={`result: ${message.toolName}`}
          color={message.isError ? "error" : "default"}
          variant="outlined"
          sx={{ alignSelf: "flex-start" }}
        />
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{
            maxHeight: 96,
            overflowY: "auto",
            whiteSpace: "pre-wrap",
          }}
        >
          {blockText(blocks, "text")}
        </Typography>
      </Stack>
    );
  }

  const thinking = blockText(blocks, "thinking");
  const text = blockText(blocks, "text");
  const toolCalls = blocks.filter((block) => block.type === "toolCall");

  return (
    <Paper variant="outlined" sx={{ p: 1.25 }}>
      <Typography variant="caption" color="text.secondary">Assistant</Typography>
      {thinking.length > 0 && (
        <Accordion elevation={0} sx={{ "&:before": { display: "none" }, mt: 0.5 }}>
          <AccordionSummary expandIcon={<ExpandMore />} sx={{ minHeight: 28, px: 1 }}>
            <Typography variant="caption" color="text.secondary">Thinking</Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ pt: 0 }}>
            <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "pre-wrap" }}>
              {thinking}
            </Typography>
          </AccordionDetails>
        </Accordion>
      )}
      {text.trim().length > 0 && (
        <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", mt: 0.5 }}>
          {text}
        </Typography>
      )}
      {toolCalls.length > 0 && (
        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1, mt: 1 }}>
          {toolCalls.map((call, index) => (
            <Chip key={index} size="small" color="primary" variant="outlined" label={`→ ${call.name}`} />
          ))}
        </Stack>
      )}
    </Paper>
  );
}

function ConversationSidebar({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const store = useStore();
  const messages = (store.conversation ?? []) as unknown as ConversationMessage[];
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const last = messages[messages.length - 1];
  const lastContentLength = (() => {
    const blocks = toBlocks(last?.content);
    let size = 0;
    for (const block of blocks) {
      size += (block.text?.length ?? 0) + (block.thinking?.length ?? 0);
    }
    return size;
  })();

  useEffect(() => {
    const scroller = scrollRef.current;
    if (open && scroller != null) {
      scroller.scrollTop = scroller.scrollHeight;
    }
  }, [open, messages.length, lastContentLength]);

  return (
    <Paper
      component="aside"
      variant="outlined"
      sx={{
        width: { xs: "85vw", sm: 380 },
        maxWidth: "85vw",
        flexShrink: 0,
        position: "sticky",
        top: 16,
        maxHeight: "calc(100vh - 32px)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <Stack
        direction="row"
        sx={{ alignItems: "center", gap: 1, px: 2, py: 1.5, borderBottom: 1, borderColor: "divider" }}
      >
        <Forum fontSize="small" color="primary" />
        <Typography variant="subtitle1" sx={{ flexGrow: 1 }}>
          AI conversation
        </Typography>
        {store.thinkingLabel != null && (
          <>
            <CircularProgress size={16} disableShrink />
            <Button
              size="small"
              color="error"
              startIcon={<Stop />}
              onClick={store.abortAiOperation}
            >
              Stop
            </Button>
          </>
        )}
        <Tooltip title="Collapse">
          <IconButton size="small" onClick={onClose} aria-label="Collapse conversation sidebar">
            <ChevronRight />
          </IconButton>
        </Tooltip>
      </Stack>
      <Box ref={scrollRef} sx={{ flexGrow: 1, overflowY: "auto", p: 1.5 }}>
        {messages.length === 0 ? (
          <Alert severity="info">
            No conversation yet. Generate an artifact to start the agentic conversation.
          </Alert>
        ) : (
          <Stack spacing={1.5}>
            {messages.map((message, index) => (
              <MessageView key={index} message={message} />
            ))}
          </Stack>
        )}
      </Box>
    </Paper>
  );
}

export default observer(ConversationSidebar);
