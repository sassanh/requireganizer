"use client";

import {
  CallSplit,
  Close,
  ExpandMore,
  Forum,
  History,
  Person,
  Refresh,
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
  Dialog,
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
import { observer } from "mobx-react-lite";
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import {
  redoAction,
  sendMessageAction,
  undoAction,
} from "actions/actions";
import { ActionView } from "actions/ActionView";
import { describeCommand, parseCommandMessage } from "ai-agent/command";
import { disclosedThinking } from "ai-agent/thinking";
import { animationMs } from "components/animation";
import { useStore } from "store";
import {
  activateBranch,
  beginRewind,
  cancelRewind,
  commitTimelineSegment,
  getTimelineMeta,
  jumpToNode,
  onTimelineChange,
} from "store/timeline/controller";

import { sendOnEnter } from "./enterToSend";
import { describeToolOutput } from "./toolOutputSummary";

function formatHistoryTimestamp(createdAt: number): string {
  const diffMs = Date.now() - createdAt;
  const oneDay = 24 * 60 * 60 * 1000;
  const threeDays = 3 * oneDay;
  if (diffMs < oneDay) {
    return new Date(createdAt).toLocaleTimeString();
  }
  if (diffMs < threeDays) {
    const days = Math.floor(diffMs / oneDay);
    return days === 1 ? "yesterday" : `${days} days ago`;
  }
  return new Date(createdAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(diffMs > 365 * 24 * 60 * 60 * 1000 ? { year: "numeric" as const } : {}),
  });
}

type ContentBlock = {
  type: string;
  text?: string;
  thinking?: string;
  thinkingSignature?: string;
  name?: string;
  id?: string;
  arguments?: unknown;
};

type ConversationMessage = {
  role: string;
  content: unknown;
  toolName?: string;
  toolCallId?: string;
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

function ThinkingChip({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <Chip
      size="small"
      label="✦ thinking"
      variant={open ? "filled" : "outlined"}
      onClick={onClick}
      sx={{ height: 20 }}
    />
  );
}

function ThinkingPanel({ thinking }: { thinking: string }) {
  return (
    <Typography
      variant="caption"
      color="text.secondary"
      sx={{ whiteSpace: "pre-wrap", pl: 1 }}
    >
      {thinking}
    </Typography>
  );
}

const JSON_MONO = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  wordBreak: "break-all",
} as const;

function JsonTree({ name, value }: { name?: string; value: unknown }) {
  const [open, setOpen] = useState(false);

  // The conventional JSON syntax palette (keys purple, strings green,
  // numbers blue, booleans/null red) mapped onto theme roles so it adapts
  // to light and dark color schemes.
  const keyChip = name != null && (
    <Box
      component="span"
      sx={{
        bgcolor: "action.hover",
        borderRadius: 0.5,
        px: 0.5,
        mr: 0.75,
        color: "secondary.main",
      }}
    >
      {name}
    </Box>
  );

  if (value == null || typeof value !== "object") {
    const isString = typeof value === "string";
    const valueColor =
      isString
        ? "success.main"
        : typeof value === "number"
          ? "info.main"
          : "error.main"; // boolean | null
    return (
      <Box sx={{ display: "flex", alignItems: "baseline", my: 0.5 }}>
        {keyChip}
        <Box
          component="span"
          sx={{
            ...JSON_MONO,
            color: valueColor,
            ...(isString && {
              bgcolor: (theme) => alpha(theme.palette.success.main, 0.07),
              borderRadius: 0.5,
              px: 0.5,
            }),
          }}
        >
          {JSON.stringify(value) ?? "null"}
        </Box>
      </Box>
    );
  }

  const entries = Object.entries(value);
  return (
    <Box sx={{ my: 0.5 }}>
      <Box
        onClick={() => setOpen((current) => !current)}
        sx={{ display: "flex", alignItems: "baseline", cursor: "pointer", userSelect: "none" }}
      >
        {keyChip}
        <Box component="span" sx={{ ...JSON_MONO, color: "text.secondary", mr: 0.75 }}>
          {open ? "▾" : "▸"} {Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`}
        </Box>
      </Box>
      <Collapse in={open}>
        {/* Vertical guide line behind the indentation level. */}
        <Box sx={{ ml: 1.5, pl: 1, borderLeft: 1, borderColor: "divider" }}>
          {entries.map(([key, child]) => (
            <JsonTree key={key} name={key} value={child} />
          ))}
        </Box>
      </Collapse>
    </Box>
  );
}

function jsonOrText(text: string) {
  try {
    return <JsonTree value={JSON.parse(text)} />;
  } catch {
    return (
      <Typography variant="caption" sx={{ whiteSpace: "pre-wrap" }}>
        {text}
      </Typography>
    );
  }
}

function ToolCallChip({
  toolName,
  result,
  open,
  onClick,
}: {
  toolName: string;
  result?: { text: string; isError: boolean };
  open: boolean;
  onClick: () => void;
}) {
  const isError = result?.isError === true;
  return (
    <Chip
      size="small"
      color={isError ? "error" : "primary"}
      variant={open && !isError ? "filled" : "outlined"}
      label={result == null ? toolName : describeToolOutput(toolName, result.text, isError)}
      onClick={onClick}
      sx={{ height: 20, maxWidth: "100%" }}
    />
  );
}

function ToolCallDialog({
  toolName,
  callId,
  args,
  result,
  onClose,
}: {
  toolName: string;
  callId: string;
  args: unknown;
  result?: { text: string; isError: boolean };
  onClose: () => void;
}) {
  const isError = result?.isError === true;
  const sectionLabel = {
    display: "block",
    fontWeight: 700,
    fontSize: 10,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    mb: 0.5,
  };
  return (
    <Dialog
      open
      onClose={onClose}
      maxWidth={false}
      slotProps={{
        paper: {
          sx: {
            // Vertical window with a fixed size: two hard halves that
            // scroll internally and never resize with their content.
            width: "min(880px, 92vw)",
            height: "82vh",
            flex: "0 0 auto",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          },
        },
      }}
    >
      <Box
        sx={{
          height: "50%",
          flex: "0 0 auto",
          minHeight: 0,
          overflowY: "auto",
          boxSizing: "border-box",
          p: 2,
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center" }}>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ ...sectionLabel, flexGrow: 1, mb: 0.5 }}
          >
            Call · {toolName}
          </Typography>
          <IconButton size="small" aria-label="Close" onClick={onClose}>
            <Close fontSize="small" />
          </IconButton>
        </Box>
        <JsonTree value={{ id: callId, arguments: args }} />
      </Box>
      <Box
        sx={{
          height: "50%",
          flex: "0 0 auto",
          minHeight: 0,
          overflowY: "auto",
          boxSizing: "border-box",
          p: 2,
        }}
      >
        <Typography variant="caption" color="text.secondary" sx={sectionLabel}>
          Result
        </Typography>
        {result == null ? (
          <Typography variant="caption" color="text.secondary">
            Pending…
          </Typography>
        ) : isError ? (
          <Typography variant="caption" color="error" sx={{ whiteSpace: "pre-wrap" }}>
            {result.text}
          </Typography>
        ) : (
          jsonOrText(result.text)
        )}
      </Box>
    </Dialog>
  );
}

const MessageView = memo(function MessageView({
  message,
  index,
  busy,
  onRevert,
  toolCallsByCallId,
  toolResultsByCallId,
}: {
  message: ConversationMessage;
  index: number;
  busy: boolean;
  onRevert: (index: number) => void;
  toolCallsByCallId: Map<string, { name: string; args: unknown }>;
  toolResultsByCallId: Map<string, { text: string; isError: boolean }>;
}) {
  const blocks = toBlocks(message.content);

  // Tool/thinking activity units: chips render in one row; the expanded
  // unit's panel renders below the row (never inside it — a full-width
  // panel would force the row to wrap). Thinking blocks with no disclosed
  // text (encrypted-only reasoning the provider did not summarize) render
  // no chip: a chip promising content it cannot reveal is worse than none.
  const units = blocks
    .map((block, blockIndex) => {
      if (block.type === "thinking") {
        const thinking = disclosedThinking(block);
        if (thinking.length === 0) return null;
        return {
          key: `thinking-${blockIndex}`,
          kind: "thinking" as const,
          thinking,
        };
      }
      if (block.type === "toolCall" && block.id != null) {
        return {
          key: `call-${blockIndex}`,
          kind: "call" as const,
          toolName: block.name ?? "",
          callId: block.id,
          args: block.arguments,
          result: toolResultsByCallId.get(block.id),
        };
      }
      return null;
    })
    .filter((unit) => unit != null);
  const [openUnitKey, setOpenUnitKey] = useState<string | null>(null);

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
    // Merged into the call's chip at the assistant message; the map-level
    // filter above normally skips these before we get here.
    const callId = message.toolCallId;
    if (callId != null && toolCallsByCallId.has(callId)) return null;
    const text = blockText(blocks, "text");
    const isError = message.isError === true;
    return (
      <Stack direction="row" sx={{ flexWrap: "wrap", rowGap: 0.5 }}>
        <Chip
          size="small"
          color={isError ? "error" : "primary"}
          variant="outlined"
          label={describeToolOutput(message.toolName ?? "", text, isError)}
          sx={{ height: 20, maxWidth: "100%" }}
        />
      </Stack>
    );
  }

  const text = blockText(blocks, "text");

  if (text.trim().length === 0 && units.length === 0) {
    return null;
  }

  return (
    <Stack spacing={0.5}>
      {units.length > 0 && (
        <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 0.5 }}>
          {units.map((unit) =>
            unit.kind === "thinking" ? (
              <ThinkingChip
                key={unit.key}
                open={openUnitKey === unit.key}
                onClick={() => setOpenUnitKey((current) => (current === unit.key ? null : unit.key))}
              />
            ) : (
              <ToolCallChip
                key={unit.key}
                toolName={unit.toolName}
                result={unit.result}
                open={openUnitKey === unit.key}
                onClick={() => setOpenUnitKey((current) => (current === unit.key ? null : unit.key))}
              />
            ),
          )}
        </Stack>
      )}
      {units.map((unit) =>
        openUnitKey === unit.key ? (
          unit.kind === "thinking" ? (
            <ThinkingPanel key={unit.key} thinking={unit.thinking} />
          ) : (
            <ToolCallDialog
              key={unit.key}
              toolName={unit.toolName}
              callId={unit.callId}
              args={unit.args}
              result={unit.result}
              onClose={() => setOpenUnitKey(null)}
            />
          )
        ) : null,
      )}
      {text.trim().length > 0 && (
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            p: ({ children }) => (
              <Typography variant="body2">
                {children}
              </Typography>
            ),
            // The app-wide CSS reset removes list indentation; without these
            // overrides the outside-positioned markers overflow or misalign.
            ul: ({ children }) => (
              <Box
                component="ul"
                sx={{
                  my: 0.5,
                  pl: 3,
                  ml: 0,
                  listStyleType: "disc",
                  listStylePosition: "outside",
                  minWidth: 0,
                }}
              >
                {children}
              </Box>
            ),
            ol: ({ children }) => (
              <Box
                component="ol"
                sx={{
                  my: 0.5,
                  pl: 3,
                  ml: 0,
                  listStyleType: "decimal",
                  listStylePosition: "outside",
                  minWidth: 0,
                }}
              >
                {children}
              </Box>
            ),
            li: ({ children }) => (
              <Typography
                component="li"
                variant="body2"
                sx={{
                  display: "list-item",
                  my: 1,
                }}
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
});

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
        sx={{ transition: `opacity ${animationMs(150)}ms ease` }}
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

function ConversationSidebar() {
  const store = useStore();
  const messages = useMemo(
    () => (store.conversation ?? []) as unknown as ConversationMessage[],
    [store.conversation],
  );

  // Join indexes for tool activity: each call chip (rendered at the
  // assistant message, in block order) looks up its result by call id; each
  // result message defers to its call's chip.
  const { toolCallsByCallId, toolResultsByCallId } = useMemo(() => {
    const calls = new Map<string, { name: string; args: unknown }>();
    const results = new Map<string, { text: string; isError: boolean }>();
    for (const message of messages) {
      if (message.role === "assistant") {
        for (const block of toBlocks(message.content)) {
          if (block.type === "toolCall" && typeof block.id === "string") {
            calls.set(block.id, { name: block.name ?? "", args: block.arguments });
          }
        }
      } else if (message.role === "toolResult" && typeof message.toolCallId === "string") {
        results.set(message.toolCallId, {
          text: blockText(toBlocks(message.content), "text"),
          isError: message.isError === true,
        });
      }
    }
    return { toolCallsByCallId: calls, toolResultsByCallId: results };
  }, [messages]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Auto-scroll only while the reader keeps the viewport within the last 5%
  // of the scroll course; scrolling up pauses following until they return.
  const followsLatestRef = useRef(true);
  const busy = store.isBusy;
  // Rewind mode: pressing rewind on a message jumps the timeline to the
  // state before that message's turn — artifacts and conversation revert
  // together. The composer is prefilled with the message being rewritten;
  // cancel re-activates the saved leaf (exact pre-rewind state), and a
  // composer send commits the branch: the new turn is grafted under the
  // rewound node while the discarded path stays as a sibling branch.
  const timelineMeta = useSyncExternalStore(
    onTimelineChange,
    getTimelineMeta,
    getTimelineMeta,
  );
  const isRewinding = timelineMeta.isRewinding;
  // The composer draft is lifted here so rewinding can prefill it with the
  // message being rewritten and cancelling restores whatever was typed
  // before the rewind started.
  const [composerDraft, setComposerDraft] = useState("");
  const [draftBeforeRewind, setDraftBeforeRewind] = useState("");
  const rewoundIndexRef = useRef<number | null>(null);
  // Cancelling a rewind flashes the anchor message so the reader keeps their
  // bearings inside the restored transcript instead of getting lost.
  const entryRefs = useRef(new Map<number, HTMLDivElement | null>());
  const highlightTimerRef = useRef<number | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [branchMenu, setBranchMenu] = useState<{
    anchor: HTMLElement;
    alternatives: { id: string; label: string; createdAt: number; preview: string }[];
  } | null>(null);

  useEffect(() => () => {
    if (highlightTimerRef.current != null) {
      window.clearTimeout(highlightTimerRef.current);
    }
  }, []);

  const startRewind = (index: number) => {
    if (busy) return;
    // Prefill the composer with the message being rewritten, remember the
    // in-progress draft for cancel, and jump the tree to the state before
    // the message's turn. While already rewinding, keep the original
    // `draftBeforeRewind`/`rewoundIndexRef` so cancel returns to the true
    // pre-rewind leaf instead of the intermediate rewound state.
    const anchorText = blockText(toBlocks(messages[index]?.content), "text");
    const wasRewinding = isRewinding;
    if (!wasRewinding) {
      setDraftBeforeRewind(composerDraft);
      rewoundIndexRef.current = index;
    }
    setComposerDraft(anchorText);
    if (!beginRewind(index)) {
      // Nothing to rewind to (message not bound to a timeline turn).
      // Only clear the save we just made; a nested failure must leave the
      // original pre-rewind save intact so cancel still heals to the first
      // leaf.
      if (!wasRewinding) {
        setDraftBeforeRewind("");
        rewoundIndexRef.current = null;
      }
      // On a nested failure the composer now holds the new anchor text;
      // keep it — the user explicitly asked to rewrite that older message.
      // Cancel will still restore the original draft.
    } else if (wasRewinding) {
      // Successful nested rewind: keep the original `rewoundIndexRef` for
      // the blink on cancel, but the tree's `rewindSavedLeafId` is already
      // preserved by the controller. `draftBeforeRewind` stays the original
      // draft, `composerDraft` is the latest anchor.
    }
  };

  // A stable identity keeps the memoized message list from re-rendering
  // whenever this handler's closures change.
  const revertHandlerRef = useRef<(index: number) => void>(() => {});
  useEffect(() => {
    revertHandlerRef.current = startRewind;
  });
  const handleRevert = useCallback(
    (index: number) => revertHandlerRef.current(index),
    [],
  );

  const pinToLatest = useCallback(() => {
    // Sending or regenerating is an explicit intent to follow the
    // conversation — re-attach auto-scroll even if the reader had scrolled
    // away (rewind reveal, reading history).
    followsLatestRef.current = true;
  }, []);

  const cancelRewindHandler = useCallback(() => {
    if (busy) return;
    // Detach auto-follow first: the restored transcript is longer than the
    // rewound view, and the follow effect would otherwise yank the pane to
    // the bottom, cancelling the smooth reveal below.
    followsLatestRef.current = false;
    cancelRewind();
    setComposerDraft(draftBeforeRewind);
    setDraftBeforeRewind("");
    const index = rewoundIndexRef.current;
    rewoundIndexRef.current = null;
    if (index == null) return;
    // Runs after the restored transcript has painted, so the node exists.
    setHighlightedIndex(index);
  }, [busy, draftBeforeRewind]);

  const clearRewind = useCallback(() => {
    setDraftBeforeRewind("");
  }, []);

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

  const last = messages[messages.length - 1];
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
  }, [store.conversationSidebarOpen, messages.length, lastContentLength]);

  // Regenerate replays the last user prompt, so any user message — with or
  // without a reply — is enough to offer it.
  const hasPrompt = messages.some((message) => message.role === "user");

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
        position: "relative",
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
        <ActionView
          variant="iconbutton"
          action={undoAction}
          target={{ blocked: busy, available: timelineMeta.canUndo }}
          size="small"
        />
        <ActionView
          variant="iconbutton"
          action={redoAction}
          target={{ blocked: busy, available: timelineMeta.canRedo }}
          size="small"
        />
        <Tooltip title="History">
          <span>
            <IconButton
              size="small"
              aria-label="Toggle history"
              disabled={timelineMeta.entries.length === 0}
              onClick={() => setHistoryOpen((open) => !open)}
            >
              <History fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
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
      <Collapse
        in={historyOpen}
        sx={{ position: "absolute", top: 48, left: 0, right: 0, zIndex: 2 }}
      >
        <Box
          sx={{
            maxHeight: 200,
            overflowY: "auto",
            borderBottom: 1,
            borderColor: "divider",
            bgcolor: "background.paper",
            boxShadow: 1,
          }}
        >
          <List dense disablePadding>
            {timelineMeta.entries
              .map((entry, index) => ({ entry, index }))
              .reverse()
              .map(({ entry, index }) => (
                <ListItemButton
                  key={entry.id}
                  dense
                  selected={index === timelineMeta.entries.length - 1}
                  disabled={busy}
                  onClick={() => jumpToNode(entry.id)}
                  sx={{ py: 0.25 }}
                >
                  <Stack
                    direction="row"
                    spacing={0.75}
                    sx={{ alignItems: "center", minWidth: 0, width: "100%" }}
                  >
                    {entry.source === "ai" ? (
                      <SmartToy fontSize="small" color="primary" sx={{ fontSize: 14 }} />
                    ) : (
                      <Person fontSize="small" sx={{ fontSize: 14 }} />
                    )}
                    <Typography
                      variant="caption"
                      noWrap
                      sx={{
                        flexGrow: 1,
                        fontWeight:
                          index === timelineMeta.entries.length - 1 ? 700 : 400,
                        fontStyle: entry.stateOnly ? "italic" : "normal",
                      }}
                    >
                      {entry.stateOnly ? `${entry.label} (state)` : entry.label}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {formatHistoryTimestamp(entry.createdAt)}
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
            {messages.map((message, index) => {
              // Tool results whose call chip already carries them (joined
              // by call id) render nothing — an empty row would still
              // consume the container's gap and double the spacing.
              const mergedIntoCall =
                message.role === "toolResult" &&
                message.toolCallId != null &&
                toolCallsByCallId.has(message.toolCallId);
              if (mergedIntoCall) return null;
              // Fork dividers render after the fork node's own messages,
              // offering its other children; suppressed while rewinding
              // because the rewind and a branch switch would fight over
              // the same tree.
              const forkEntry = timelineMeta.entries.find(
                (candidate) =>
                  candidate.alternatives.length > 0 &&
                  candidate.startIndex + candidate.messageCount === index,
              );
              const siblings = isRewinding ? null : forkEntry?.alternatives ?? null;
              return (
                <Fragment key={index}>
                  {siblings != null && siblings.length > 0 && (
                    <Chip
                      size="small"
                      icon={<CallSplit />}
                      label={`branch · ${siblings.length} kept`}
                      variant="outlined"
                      disabled={busy}
                      onClick={(event) =>
                        setBranchMenu({ anchor: event.currentTarget, alternatives: siblings })
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
                          animation: `conversationBlink ${animationMs(600)}ms ease-in-out 2`,
                        },
                      },
                    ]}
                  >
                    <MessageView
                      message={message}
                      index={index}
                      busy={busy}
                      onRevert={handleRevert}
                      toolCallsByCallId={toolCallsByCallId}
                      toolResultsByCallId={toolResultsByCallId}
                    />
                  </Box>
                </Fragment>
              );
            })}
            {!busy && !isRewinding && hasPrompt && (
              <Tooltip title="Regenerate — replays the last prompt as a new branch">
                <Button
                  size="small"
                  startIcon={<Refresh />}
                  onClick={() => {
                    pinToLatest();
                    void store.regenerateLastReply();
                  }}
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
        {(branchMenu?.alternatives ?? []).map((alternative) => (
          <MenuItem
            key={alternative.id}
            disabled={busy}
            onClick={() => {
              setBranchMenu(null);
              activateBranch(alternative.id);
            }}
            sx={{ maxWidth: 340 }}
          >
            <Stack sx={{ minWidth: 0 }}>
              <Typography variant="caption" noWrap>
                {alternative.preview}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap>
                {alternative.label !== alternative.preview
                  ? `${alternative.label} · `
                  : ""}
                {new Date(alternative.createdAt).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </Typography>
            </Stack>
          </MenuItem>
        ))}
      </Menu>
      <ConversationComposer
        draft={composerDraft}
        onDraftChange={setComposerDraft}
        rewinding={isRewinding}
        onCommitRewind={clearRewind}
        onCancelRewind={cancelRewindHandler}
        onSendIntent={pinToLatest}
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
            transition: `transform ${animationMs(150)}ms ease`,
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

const ConversationComposer = memo(function ConversationComposer({
  draft,
  onDraftChange,
  rewinding,
  onCommitRewind,
  onCancelRewind,
  onSendIntent,
}: {
  draft: string;
  onDraftChange: (draft: string) => void;
  rewinding: boolean;
  onCommitRewind: () => void;
  onCancelRewind: () => void;
  onSendIntent: () => void;
}) {
  const store = useStore();
  const rewindActive = rewinding;

  const sendDraft = () => {
    const trimmed = draft.trim();
    if (trimmed.length === 0) return;
    onDraftChange("");
    onSendIntent();
    if (rewindActive) {
      // Committing a rewind: the store conversation already ends at the
      // rewound point, so a plain send branches from there. The discarded
      // path stays as a sibling branch in the tree.
      onCommitRewind();
    }
    void store.sendConversationMessage({ message: trimmed });
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
          onKeyDown={(event) => sendOnEnter(event, sendDraft)}
          placeholder={rewindActive ? "Continue from here…" : "Ask the agent…"}
          multiline
          maxRows={6}
          fullWidth
          size="small"
          disabled={store.isBusy}
        />
        <ActionView
          variant="iconbutton"
          action={sendMessageAction}
          target={{ blocked: store.isBusy, text: draft, send: sendDraft }}
          color="primary"
        />
      </Stack>
    </Box>
  );
});

export default observer(ConversationSidebar);
