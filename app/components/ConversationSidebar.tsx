"use client";

import { Forum, Stop } from "@mui/icons-material";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { observer } from "mobx-react-lite";
import { useEffect, useRef, useState } from "react";

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

function InlineThinking({ thinking }: { thinking: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Chip
        size="small"
        label="✦ thinking"
        variant={open ? "filled" : "outlined"}
        onClick={() => setOpen((value) => !value)}
        sx={{ height: 20 }}
      />
      <Collapse in={open} sx={{ width: "100%" }}>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ whiteSpace: "pre-wrap", pl: 1 }}
        >
          {thinking}
        </Typography>
      </Collapse>
    </>
  );
}

function InlineOutput({
  output,
  isError,
}: {
  output: string;
  isError?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Chip
        size="small"
        label={isError ? "✕ output" : "▸ output"}
        color={isError ? "error" : "default"}
        variant="outlined"
        onClick={() => setOpen((value) => !value)}
        sx={{ height: 20 }}
      />
      <Collapse in={open} sx={{ width: "100%" }}>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{
            whiteSpace: "pre-wrap",
            pl: 1,
            maxHeight: 240,
            overflowY: "auto",
          }}
        >
          {output}
        </Typography>
      </Collapse>
    </>
  );
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
      <Stack direction="row" sx={{ flexWrap: "wrap", rowGap: 0.5 }}>
        <InlineOutput
          output={blockText(blocks, "text")}
          isError={message.isError}
        />
      </Stack>
    );
  }

  const thinking = blockText(blocks, "thinking");
  const text = blockText(blocks, "text");
  const toolCalls = blocks.filter((block) => block.type === "toolCall");

  if (text.trim().length === 0 && thinking.length === 0 && toolCalls.length === 0) {
    return null;
  }

  return (
    <Stack spacing={0.5}>
      {(toolCalls.length > 0 || thinking.length > 0) && (
        <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 0.5 }}>
          {toolCalls.map((call, index) => (
            <Chip
              key={index}
              size="small"
              color="primary"
              variant="outlined"
              label={`→ ${call.name}`}
              sx={{ height: 20 }}
            />
          ))}
          {thinking.length > 0 && <InlineThinking thinking={thinking} />}
        </Stack>
      )}
      {text.trim().length > 0 && (
        <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
          {text}
        </Typography>
      )}
    </Stack>
  );
}

function ConversationSidebar() {
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
    if (store.conversationSidebarOpen && scroller != null) {
      scroller.scrollTop = scroller.scrollHeight;
    }
  }, [store.conversationSidebarOpen, messages.length, lastContentLength]);

  return (
    <Paper
      component="aside"
      variant="outlined"
      sx={{
        width: { xs: "85vw", sm: 380 },
        maxWidth: "85vw",
        flexShrink: 0,
        // The workspace row already fills the viewport below the top bar, so
        // a plain 100% keeps the sidebar fully visible without stickiness.
        height: "100%",
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
