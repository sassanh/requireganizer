"use client";

import {
  CallSplit,
  Close,
  Download,
  ExpandMore,
  Forum,
  History,
  Person,
  Redo,
  Refresh,
  Send,
  SmartToy,
  Stop,
  Undo,
} from "@mui/icons-material";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  IconButton,
  List,
  ListItemButton,
  Menu,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import { saveAs } from "file-saver";
import { observer } from "mobx-react-lite";
import {
  Fragment,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { describeCommand, parseCommandMessage } from "ai-agent/command";
import { useStore } from "store";
import {
  branchForkIndex,
  branchTailPreview,
  isBranchAttachable,
} from "store/conversation-branches";
import type { ConversationBranchRecord } from "store/conversation-branches";
import {
  canRedo,
  canUndo,
  commitTimelineSegment,
  jumpToNode,
  onTimelineChange,
  redo,
  timelineCursor,
  timelineEntries,
  undo,
} from "store/timeline/controller";

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

function MessageView({
  message,
  index,
  busy,
  onRevert,
}: {
  message: ConversationMessage;
  index: number;
  busy: boolean;
  onRevert: (index: number) => void;
}) {
  const blocks = toBlocks(message.content);

  if (message.role === "user") {
    const text = blockText(blocks, "text");
    const command = parseCommandMessage(text);
    if (command != null) {
      return <CommandBubble summary={describeCommand(command)} raw={text} />;
    }
    return (
      <UserBubble text={text} index={index} busy={busy} onRevert={onRevert} />
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
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            p: ({ children }) => (
              <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                {children}
              </Typography>
            ),
            // The app-wide CSS reset removes list indentation; without these
            // overrides the outside-positioned markers overflow the pane.
            ul: ({ children }) => (
              <Box
                component="ul"
                sx={{ my: 0.5, pl: 3, listStyleType: "disc", minWidth: 0 }}
              >
                {children}
              </Box>
            ),
            ol: ({ children }) => (
              <Box
                component="ol"
                sx={{ my: 0.5, pl: 3, listStyleType: "decimal", minWidth: 0 }}
              >
                {children}
              </Box>
            ),
            li: ({ children }) => (
              <Typography
                component="li"
                variant="body2"
                sx={{ whiteSpace: "pre-wrap", my: 0.25 }}
              >
                {children}
              </Typography>
            ),
            hr: () => (
              <Box
                component="hr"
                sx={{ my: 1, border: "none", borderTop: 1, borderColor: "divider" }}
              />
            ),
            code: ({ children }) => (
              <Box
                component="code"
                sx={{
                  fontFamily: "monospace",
                  fontSize: 12,
                  px: 0.5,
                  borderRadius: 0.5,
                  bgcolor: (theme) => alpha(theme.palette.text.primary, 0.08),
                }}
              >
                {children}
              </Box>
            ),
            pre: ({ children }) => (
              <Box
                component="pre"
                sx={{
                  m: 0,
                  p: 1,
                  overflowX: "auto",
                  borderRadius: 1,
                  fontSize: 12,
                  bgcolor: (theme) => alpha(theme.palette.text.primary, 0.06),
                }}
              >
                {children}
              </Box>
            ),
          }}
        >
          {text}
        </ReactMarkdown>
      )}
    </Stack>
  );
}

function UserBubble({
  text,
  index,
  busy,
  onRevert,
}: {
  text: string;
  index: number;
  busy: boolean;
  onRevert: (index: number) => void;
}) {
  return (
    <Box
      sx={{
        alignSelf: "flex-end",
        ml: 8,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: 0.25,
        maxWidth: "100%",
        // Chat-app convention: the reader's own bubbles sit flush to the
        // right edge on a faint accent tint with an accent border, and their
        // actions tuck underneath. Actions reveal on hover; touch devices
        // keep them permanently visible.
        "& .message-actions": {
          opacity: { xs: 1, md: 0 },
          "@media (hover: none)": { opacity: 1 },
        },
        "&:hover .message-actions": { opacity: 1 },
      }}
    >
      <Paper
        variant="outlined"
        className="message-bubble"
        sx={{
          p: 1.25,
          minWidth: 0,
          bgcolor: (theme) => alpha(theme.palette.primary.main, 0.08),
          borderColor: "primary.main",
        }}
      >
        <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
          {text}
        </Typography>
      </Paper>
      <Stack
        className="message-actions"
        direction="row"
        spacing={0}
        sx={{ transition: "opacity 150ms ease" }}
      >
        <Tooltip title="Rewind here — continue from before this message">
          <span>
            <IconButton
              size="small"
              aria-label="Revert to before this message"
              disabled={busy}
              onClick={() => onRevert(index)}
            >
              <Undo fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
    </Box>
  );
}

/**
 * Dev-only escape hatch: dump the raw conversation transcript to a JSON file
 * so a failing conversation can be shared and investigated offline.
 */
function DevExportConversationButton({ messages }: { messages: ConversationMessage[] }) {
  const exportConversation = () => {
    saveAs(
      new Blob([JSON.stringify(messages, null, 2)], { type: "application/json;charset=utf-8" }),
      `requireganizer-conversation-${Date.now()}.json`,
    );
  };

  return (
    <Tooltip title="Export conversation JSON (dev only)">
      <span>
        <IconButton
          size="small"
          aria-label="Export conversation JSON"
          disabled={messages.length === 0}
          onClick={exportConversation}
        >
          <Download fontSize="small" />
        </IconButton>
      </span>
    </Tooltip>
  );
}

function ConversationSidebar() {
  const store = useStore();
  const messages = (store.conversation ?? []) as unknown as ConversationMessage[];
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Auto-scroll only while the reader keeps the viewport within the last 5%
  // of the scroll course; scrolling up pauses following until they return.
  const followsLatestRef = useRef(true);
  const busy = store.isBusy;
  // Rewind mode: the transcript is shown up to (excluding) this user message
  // and the next composer send branches from here, discarding the turn and
  // everything after it. Nothing is committed until that send; cancel simply
  // clears the view back to the full transcript. The anchor only counts
  // while it still points at a user message, so stale indices invalidate
  // themselves.
  const [revertAnchorIndex, setRevertAnchorIndex] = useState<number | null>(null);
  const revertAnchor = revertAnchorIndex != null && messages[revertAnchorIndex]?.role === "user"
    ? revertAnchorIndex
    : null;
  // The composer draft is lifted here so rewinding can prefill it with the
  // message being rewritten and cancelling restores whatever was typed
  // before the rewind started.
  const [composerDraft, setComposerDraft] = useState("");
  const [draftBeforeRewind, setDraftBeforeRewind] = useState("");
  // Cancelling a rewind flashes the anchor message so the reader keeps their
  // bearings inside the restored transcript instead of getting lost.
  const entryRefs = useRef(new Map<number, HTMLDivElement | null>());
  const highlightTimerRef = useRef<number | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null);
  // Kept branch tails that can reattach to the live transcript, grouped by
  // their fork position so each fork renders one divider listing siblings.
  const attachableBranches = (store.conversationBranches ?? [])
    .filter((record) => isBranchAttachable(record, messages));
  const branchesByFork = new Map<number, ConversationBranchRecord[]>();
  for (const record of attachableBranches) {
    const forkIndex = branchForkIndex(record);
    const siblings = branchesByFork.get(forkIndex) ?? [];
    siblings.push(record);
    branchesByFork.set(forkIndex, siblings);
  }
  const [branchMenu, setBranchMenu] = useState<{
    anchor: HTMLElement;
    forkIndex: number;
  } | null>(null);
  // Timeline (undo/redo) state lives outside mobx; subscribe to it
  // externally so the pane re-renders when nodes are recorded or restored.
  const timeline = useSyncExternalStore(
    onTimelineChange,
    timelineEntries,
    timelineEntries,
  );
  const cursor = useSyncExternalStore(
    onTimelineChange,
    timelineCursor,
    timelineCursor,
  );
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") {
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => () => {
    if (highlightTimerRef.current != null) {
      window.clearTimeout(highlightTimerRef.current);
    }
  }, []);

  const startRevert = (index: number) => {
    if (busy) return;
    // Prefill the composer with the message being rewritten. The first
    // rewind also remembers the in-progress draft so cancelling can put it
    // back; moving the anchor to another message keeps that original backup.
    if (revertAnchorIndex == null) {
      setDraftBeforeRewind(composerDraft);
    }
    setComposerDraft(blockText(toBlocks(messages[index]?.content), "text"));
    setRevertAnchorIndex(index);
  };

  const cancelRevert = () => {
    if (busy) return;
    const index = revertAnchorIndex;
    // Detach auto-follow first: the restored transcript is longer than the
    // rewound view, and the follow effect would otherwise yank the pane to
    // the bottom, cancelling the smooth reveal below.
    followsLatestRef.current = false;
    setRevertAnchorIndex(null);
    setComposerDraft(draftBeforeRewind);
    setDraftBeforeRewind("");
    if (index == null) return;
    // Runs after the restored transcript has painted, so the node exists.
    setHighlightedIndex(index);
  };

  useEffect(() => {
    if (highlightedIndex == null) return;
    entryRefs.current.get(highlightedIndex)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
    if (highlightTimerRef.current != null) {
      window.clearTimeout(highlightTimerRef.current);
    }
    highlightTimerRef.current = window.setTimeout(() => {
      setHighlightedIndex(null);
    }, 1600);
    return () => {
      if (highlightTimerRef.current != null) {
        window.clearTimeout(highlightTimerRef.current);
      }
    };
  }, [highlightedIndex]);

  // While rewinding, render the prefix before the anchor; indices stay
  // aligned with the store transcript so actions keep addressing real
  // entries.
  const visibleCount = revertAnchor ?? messages.length;
  const visibleMessages = messages.slice(0, visibleCount);
  const last = visibleMessages[visibleMessages.length - 1];
  const lastContentLength = (() => {
    const blocks = toBlocks(last?.content);
    let size = 0;
    for (const block of blocks) {
      size += (block.text?.length ?? 0) + (block.thinking?.length ?? 0);
    }
    return size;
  })();

  const followLatestWhilePinned = () => {
    const scroller = scrollRef.current;
    if (!store.conversationSidebarOpen || scroller == null) return;
    if (!followsLatestRef.current) return;
    scroller.scrollTop = scroller.scrollHeight;
  };

  const handleScroll = () => {
    const scroller = scrollRef.current;
    if (scroller == null) return;
    const course = scroller.scrollHeight - scroller.clientHeight;
    followsLatestRef.current =
      course <= 0 || scroller.scrollTop / course >= 0.95;
  };

  useEffect(() => {
    followLatestWhilePinned();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- follow content changes only
  }, [store.conversationSidebarOpen, visibleMessages.length, lastContentLength]);

  const hasReply = visibleMessages.some((message) => message.role === "assistant");

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
        <Tooltip title="Undo (Cmd+Z)">
          <span>
            <IconButton
              size="small"
              aria-label="Undo"
              disabled={busy || cursor <= 0}
              onClick={undo}
            >
              <Undo fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Redo (Cmd+Shift+Z)">
          <span>
            <IconButton
              size="small"
              aria-label="Redo"
              disabled={busy || cursor >= timeline.length - 1}
              onClick={redo}
            >
              <Redo fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="History">
          <span>
            <IconButton
              size="small"
              aria-label="Toggle history"
              disabled={timeline.length === 0}
              onClick={() => setHistoryOpen((open) => !open)}
            >
              <History fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        {process.env.NODE_ENV === "development" && (
          <DevExportConversationButton messages={messages} />
        )}
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
      <Collapse in={historyOpen}>
        <Box sx={{ maxHeight: 200, overflowY: "auto", borderBottom: 1, borderColor: "divider" }}>
          <List dense disablePadding>
            {timeline
              .map((node, index) => ({ node, index }))
              .reverse()
              .map(({ node, index }) => (
                <ListItemButton
                  key={node.id}
                  dense
                  selected={index === cursor}
                  disabled={busy}
                  onClick={() => jumpToNode(index)}
                  sx={{ py: 0.25 }}
                >
                  <Stack
                    direction="row"
                    spacing={0.75}
                    sx={{ alignItems: "center", minWidth: 0, width: "100%" }}
                  >
                    {node.source === "ai" ? (
                      <SmartToy fontSize="small" color="primary" sx={{ fontSize: 14 }} />
                    ) : (
                      <Person fontSize="small" sx={{ fontSize: 14 }} />
                    )}
                    <Typography
                      variant="caption"
                      noWrap
                      sx={{ flexGrow: 1, fontWeight: index === cursor ? 700 : 400 }}
                    >
                      {node.label}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {new Date(node.createdAt).toLocaleTimeString()}
                    </Typography>
                  </Stack>
                </ListItemButton>
              ))}
          </List>
        </Box>
      </Collapse>
      <Box ref={scrollRef} onScroll={handleScroll} sx={{ flexGrow: 1, overflowY: "auto", p: 1.5 }}>
        {messages.length === 0 ? (
          <Alert severity="info">
            No conversation yet. Generate an artifact to start the agentic conversation.
          </Alert>
        ) : (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
            {messages.slice(0, visibleCount).map((message, index) => {
              // Fork dividers render above the message that follows the fork
              // point; suppressed while rewinding because the anchor and a
              // branch switch would fight over the same transcript.
              const siblings = revertAnchor == null
                ? branchesByFork.get(index)
                : undefined;
              return (
              <Fragment key={index}>
                {siblings != null && (
                  <Chip
                    size="small"
                    icon={<CallSplit />}
                    label={`branch · ${siblings.length} kept`}
                    variant="outlined"
                    disabled={busy}
                    onClick={(event) =>
                      setBranchMenu({ anchor: event.currentTarget, forkIndex: index })
                    }
                    sx={{ alignSelf: "flex-start", height: 20 }}
                  />
                )}
                <Box
                  ref={(node: HTMLDivElement | null) => {
                    if (node == null) entryRefs.current.delete(index);
                    else entryRefs.current.set(index, node);
                  }}
                  sx={[
                    { minWidth: 0 },
                    // The flash targets the message bubble itself, not the
                    // whole row container.
                    index === highlightedIndex && {
                      "& .message-bubble": {
                        "@keyframes conversationBlink": {
                          "0%, 100%": { boxShadow: "none" },
                          "50%": {
                            boxShadow: (theme) =>
                              `0 0 0 4px ${alpha(theme.palette.primary.main, 0.45)}`,
                          },
                        },
                        animation: "conversationBlink 600ms ease-in-out 2",
                      },
                    },
                  ]}
                >
                  <MessageView
                    message={message}
                    index={index}
                    busy={busy}
                    onRevert={startRevert}
                  />
                </Box>
              </Fragment>
              );
            })}
            {!busy && revertAnchor == null && hasReply && (
              <Tooltip title="Regenerate — starts a new branch from the last reply">
                <Button
                  size="small"
                  startIcon={<Refresh />}
                  onClick={() => void store.regenerateLastReply()}
                  sx={{ alignSelf: "flex-start" }}
                >
                  Regenerate
                </Button>
              </Tooltip>
            )}
          </Box>
        )}
      </Box>
      <Menu
        anchorEl={branchMenu?.anchor ?? null}
        open={branchMenu != null}
        onClose={() => setBranchMenu(null)}
      >
        {(branchMenu == null ? [] : branchesByFork.get(branchMenu.forkIndex) ?? []).map(
          (record) => (
            <MenuItem
              key={record.id}
              disabled={busy}
              onClick={() => {
                setBranchMenu(null);
                void store.switchConversationBranch({ id: record.id });
              }}
              sx={{ maxWidth: 340 }}
            >
              <Stack sx={{ minWidth: 0 }}>
                <Typography variant="caption" noWrap>
                  {branchTailPreview(record)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {new Date(record.createdAt).toLocaleString()}
                </Typography>
              </Stack>
            </MenuItem>
          ),
        )}
      </Menu>
      <ConversationComposer
        draft={composerDraft}
        onDraftChange={setComposerDraft}
        rewindAnchor={revertAnchor}
        onClearRewind={() => {
          setRevertAnchorIndex(null);
          setDraftBeforeRewind("");
        }}
        onCancelRewind={cancelRevert}
      />
    </Paper>
  );
}

function CommandBubble({ summary, raw }: { summary: string; raw: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1.25,
        // UI-initiated commands: dashed accent border marks them as generated
        // by the interface rather than typed by the reader.
        alignSelf: "flex-end",
        ml: 8,
        bgcolor: (theme) => alpha(theme.palette.primary.main, 0.08),
        borderColor: "primary.main",
        borderStyle: "dashed",
      }}
    >
      <Stack
        direction="row"
        spacing={0.75}
        onClick={() => setExpanded((open) => !open)}
        sx={{ alignItems: "center", cursor: "pointer", userSelect: "none" }}
      >
        <ExpandMore
          fontSize="small"
          sx={{
            transform: expanded ? "rotate(180deg)" : "none",
            transition: "transform 150ms ease",
          }}
        />
        <Typography variant="caption" sx={{ flexGrow: 1 }}>
          {summary}
        </Typography>
      </Stack>
      <Collapse in={expanded}>
        <Box component="pre" sx={{ m: 0, mt: 1, fontFamily: "monospace", fontSize: 11, whiteSpace: "pre-wrap" }}>
          {raw}
        </Box>
      </Collapse>
    </Paper>
  );
}

function ConversationComposer({
  draft,
  onDraftChange,
  rewindAnchor,
  onClearRewind,
  onCancelRewind,
}: {
  draft: string;
  onDraftChange: (draft: string) => void;
  rewindAnchor: number | null;
  onClearRewind: () => void;
  onCancelRewind: () => void;
}) {
  const store = useStore();
  const rewindActive = rewindAnchor != null;

  const sendDraft = () => {
    const trimmed = draft.trim();
    if (trimmed.length === 0) return;
    onDraftChange("");
    if (rewindAnchor != null) {
      // Committing a rewind branches from the anchor. Clear the pending
      // rewind first so the view returns to normal regardless of how the
      // operation ends.
      const index = rewindAnchor;
      onClearRewind();
      void store.branchFromMessage({ index, message: trimmed });
    } else {
      void store.sendConversationMessage({ message: trimmed });
    }
  };

  return (
    <Box sx={{ borderTop: 1, borderColor: "divider" }}>
      {rewindActive && (
        <Stack
          direction="row"
          sx={{ alignItems: "center", gap: 1, px: 1.5, pt: 1 }}
        >
          <Undo fontSize="small" color="primary" />
          <Typography variant="caption" sx={{ flexGrow: 1 }}>
            Rewinding — your next message continues from this point.
          </Typography>
          <Tooltip title="Cancel rewind">
            <IconButton
            size="small"
            aria-label="Cancel rewind"
            disabled={store.isBusy}
            onClick={onCancelRewind}
          >
            <Close fontSize="small" />
          </IconButton>
          </Tooltip>
        </Stack>
      )}
      <Stack
        direction="row"
        sx={{ alignItems: "flex-end", gap: 1, p: 1.5, pt: rewindActive ? 0.5 : 1.5 }}
      >
        <TextField
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              sendDraft();
            }
          }}
          placeholder={rewindActive ? "Continue from here…" : "Ask the agent…"}
          multiline
          maxRows={6}
          fullWidth
          size="small"
          disabled={store.isBusy}
        />
        <IconButton
          aria-label="Send message"
          color="primary"
          disabled={store.isBusy || draft.trim().length === 0}
          onClick={sendDraft}
        >
          <Send />
        </IconButton>
      </Stack>
    </Box>
  );
}

export default observer(ConversationSidebar);
