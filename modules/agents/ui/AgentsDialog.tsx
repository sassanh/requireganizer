"use client";

import { Add, ArchiveOutlined, Code, ContentCopy, Delete, Edit, InfoOutlined, SmartToy, Unarchive } from "@mui/icons-material";
import {
  Avatar,
  Box,
  Button,
  Card,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Popover,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import { type FormEvent, type ReactNode, useState } from "react";

import { notify } from "components/notices";
import { getUserFacingErrorMessage } from "lib/errors";

import type { ConnectionDetails } from "../record";
import type { TemplateDraft, TemplateView } from "../templates";
import { agentLabel, type AgentView } from "../view";
import { useAgents } from "./context";
import ContextDialog from "./ContextDialog";

const errorText = (error: unknown) => getUserFacingErrorMessage(error, "That did not work.");

/** What a coding agent's connection tells of it, one fact per line. */
export function detailLines(details: ConnectionDetails | null): string[] {
  if (details == null) return ["Its connection told nothing of it."];
  const tool = details.tool == null ? "an unnamed coding tool" : `${details.tool}${details.toolVersion == null ? "" : ` ${details.toolVersion}`}`;
  return [
    `Coding tool: ${tool}`,
    `Host: ${details.host ?? "unknown"}`,
    details.sessionless ? "Tells no session, so it is known by the id it was given" : "Tells its session",
    details.reachable ? "Takes messages into its session" : "Takes no messages into its session",
  ];
}

/**
 * What finds a coding agent again: the id of its session, to resume it, or
 * for a sessionless coding agent the id the system gave it, which it gives
 * back when it names itself; null when this computer kept neither.
 */
function findingId(agent: AgentView): { label: string; value: string } | null {
  if (agent.details?.sessionless === true) return { label: "Id it names itself with", value: agent.id };
  return agent.session == null ? null : { label: "Session", value: agent.session };
}

/**
 * An info icon on a coding agent that opens, on click, what finds it again,
 * with a way to copy it, and what its connection tells, one fact per line.
 */
function DetailsInfo({ agent }: { agent: AgentView }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const found = findingId(agent);
  const copy = (value: string) =>
    navigator.clipboard.writeText(value).then(
      () => notify("Copied"),
      () => notify("It could not be copied.", "error"),
    );
  return (
    <>
      <IconButton size="small" aria-label={`About ${agentLabel(agent)}`} aria-expanded={anchor != null} onClick={(event) => setAnchor(event.currentTarget)}>
        <InfoOutlined fontSize="small" />
      </IconButton>
      <Popover open={anchor != null} anchorEl={anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: "bottom", horizontal: "right" }} transformOrigin={{ vertical: "top", horizontal: "right" }}>
        <Stack spacing={1} sx={{ p: 1.5, maxWidth: 380 }}>
          {found == null ? (
            <Typography variant="body2" color="text.secondary">
              This computer has not kept its session.
            </Typography>
          ) : (
            <Stack>
              <Typography variant="caption" color="text.secondary">
                {found.label}
              </Typography>
              <Stack direction="row" sx={{ alignItems: "center", gap: 0.5 }}>
                <Typography variant="body2" sx={{ fontFamily: "monospace", overflowWrap: "anywhere", userSelect: "all" }}>
                  {found.value}
                </Typography>
                <Tooltip title="Copy">
                  <IconButton size="small" aria-label={`Copy the ${found.label.toLowerCase()}`} onClick={() => void copy(found.value)}>
                    <ContentCopy fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>
            </Stack>
          )}
          <Stack component="ul" sx={{ m: 0, pl: 2 }}>
            {detailLines(agent.details).map((line) => (
              <Typography key={line} component="li" variant="body2">
                {line}
              </Typography>
            ))}
          </Stack>
        </Stack>
      </Popover>
    </>
  );
}

/** A one-field form, sent with Enter or its button, that names an agent that has no name, showing why a name is refused. */
export function NameField({ agent }: { agent: AgentView }) {
  const { client } = useAgents();
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    client.nameAgent(agent.id, name).then(
      () => {
        setName("");
        setProblem(null);
      },
      (error: unknown) => setProblem(errorText(error)),
    );
  };
  return (
    <form onSubmit={submit}>
      <TextField
        size="small"
        fullWidth
        placeholder="Name this agent"
        value={name}
        onChange={(event) => setName(event.target.value)}
        error={problem != null}
        helperText={problem}
        slotProps={{
          htmlInput: { "aria-label": "Name this agent" },
          input: {
            endAdornment: (
              <InputAdornment position="end">
                <Button type="submit" size="small" disabled={name.trim().length === 0}>
                  Name
                </Button>
              </InputAdornment>
            ),
          },
        }}
      />
    </form>
  );
}

/** Each kind of agent's mark: an icon on a field tinted in its colour. */
const KIND_MARK = {
  coding: { Icon: Code, palette: "primary" },
  internal: { Icon: SmartToy, palette: "info" },
} as const;

function KindAvatar({ kind }: { kind: AgentView["kind"] }) {
  const { Icon, palette } = KIND_MARK[kind];
  return (
    <Avatar variant="rounded" sx={{ width: 32, height: 32, color: `${palette}.main`, bgcolor: (theme) => alpha(theme.palette[palette].main, 0.12) }}>
      <Icon sx={{ fontSize: 18 }} />
    </Avatar>
  );
}

/** A button that opens, beside it, the field that names an agent that has no name. */
function NameButton({ agent }: { agent: AgentView }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <Button size="small" onClick={(event) => setAnchor(event.currentTarget)}>
        Name
      </Button>
      <Popover open={anchor != null} anchorEl={anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: "bottom", horizontal: "left" }}>
        <Box sx={{ p: 1.5, width: 280 }}>
          <NameField agent={agent} />
        </Box>
      </Popover>
    </>
  );
}

/** The size every agent's card has, so the grid stays even. */
const CARD_WIDTH = 280;
const CARD_HEIGHT = 64;

/**
 * One agent as a card marked with its kind's avatar: by its name, or as
 * unnamed with a way to name it; for an internal agent, its template; a way to let in a connected coding agent
 * that is not let in; and its actions.
 */
function AgentCard({ agent, onProblem }: { agent: AgentView; onProblem: (problem: string | null) => void }) {
  const { client } = useAgents();
  const [showingContext, setShowingContext] = useState(false);
  const canLetIn = agent.kind === "coding" && agent.connected && agent.name != null && !agent.letIn;
  const detail = agent.kind === "internal" ? `internal agent on ${agent.template?.name ?? "no template"}` : agent.connected ? "coding agent, connected" : "coding agent, not connected";
  return (
    <Card variant="outlined" role="group" aria-label={`${agentLabel(agent)}: ${detail}`} sx={{ width: CARD_WIDTH, height: CARD_HEIGHT, display: "flex", alignItems: "center", gap: 1.25, px: 1.5 }}>
      <KindAvatar kind={agent.kind} />
      <Stack sx={{ flexGrow: 1, minWidth: 0 }}>
        <Typography variant="body2" noWrap title={agentLabel(agent)} sx={{ fontWeight: 500 }}>
          {agentLabel(agent)}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap>
          {agent.kind === "internal" ? `Internal agent · ${agent.template?.name ?? "no template"}` : "Coding agent"}
        </Typography>
      </Stack>
      {canLetIn && (
        <Button size="small" variant="contained" onClick={() => client.answerLetIn(agent.id, true).then(() => onProblem(null), (error: unknown) => onProblem(errorText(error)))}>
          Let in
        </Button>
      )}
      {agent.name == null && <NameButton agent={agent} />}
      <Stack direction="row" sx={{ flexShrink: 0 }}>
        {agent.kind === "coding" && <DetailsInfo agent={agent} />}
        {agent.kind === "internal" && (
          <Button size="small" onClick={() => setShowingContext(true)}>
            Context
          </Button>
        )}
        {agent.name != null && (
          <Tooltip title={`Archive ${agent.name}`}>
            <IconButton size="small" aria-label={`Archive ${agent.name}`} onClick={() => client.archiveAgent(agent.id).then(() => onProblem(null), (error: unknown) => onProblem(errorText(error)))}>
              <ArchiveOutlined fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Stack>
      {showingContext && <ContextDialog agentId={agent.id} topic={null} onClose={() => setShowingContext(false)} />}
    </Card>
  );
}

/** Adds or changes a template: its name, its AI provider's OpenAI-compatible endpoint, a key for that endpoint and a model. */
function TemplateForm({ initial, onSave, onClose }: { initial: TemplateView | null; onSave: (template: TemplateDraft) => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [endpoint, setEndpoint] = useState(initial?.endpoint ?? "");
  const [key, setKey] = useState("");
  const [model, setModel] = useState(initial?.model ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave({ name, endpoint, key, model }).then(onClose, (error: unknown) => setProblem(errorText(error)));
  };
  return (
    <Dialog open onClose={onClose} aria-labelledby="template-title" fullWidth maxWidth="sm">
      <form onSubmit={submit}>
        <DialogTitle id="template-title">{initial == null ? "Add a template" : `Change ${initial.name}`}</DialogTitle>
        <DialogContent>
          <Stack sx={{ gap: 2, pt: 1 }}>
            <TextField autoFocus label="Name" value={name} onChange={(event) => setName(event.target.value)} required />
            <TextField label="OpenAI-compatible endpoint" placeholder="https://openrouter.ai/api/v1" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} required />
            <TextField
              label="Key"
              type="password"
              value={key}
              onChange={(event) => setKey(event.target.value)}
              required={initial == null}
              helperText={initial == null ? undefined : "Leave empty to keep the one it has."}
            />
            <TextField label="Model" value={model} onChange={(event) => setModel(event.target.value)} required />
            {problem != null && (
              <Typography color="error" variant="body2" sx={{ whiteSpace: "pre-line" }}>
                {problem}
              </Typography>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained">
            {initial == null ? "Add" : "Save"}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

/** Starts a new internal agent from a template by giving it a name. */
function StartAgentForm({ templates }: { templates: readonly TemplateView[] }) {
  const { client } = useAgents();
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  if (templates.length === 0) return null;
  const chosen = templates.some(({ id }) => id === templateId) ? templateId : templates[0]!.id;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    client.startInternalAgent(chosen, name).then(
      () => {
        setName("");
        setProblem(null);
      },
      (error: unknown) => setProblem(errorText(error)),
    );
  };
  return (
    <Stack component="form" direction="row" onSubmit={submit} sx={{ gap: 1, alignItems: "flex-start", flexWrap: "wrap" }}>
      <TextField select size="small" label="Template" value={chosen} onChange={(event) => setTemplateId(event.target.value)} sx={{ minWidth: 160 }}>
        {templates.map((template) => (
          <MenuItem key={template.id} value={template.id}>
            {template.name}
          </MenuItem>
        ))}
      </TextField>
      <TextField size="small" label="Name" value={name} onChange={(event) => setName(event.target.value)} required error={problem != null} helperText={problem} />
      <Button type="submit" size="small" startIcon={<Add />}>
        Start an agent
      </Button>
    </Stack>
  );
}

/** The spec owner's templates, to add, change and remove; a removal refused says which agents keep it. */
function TemplateList() {
  const { client, view } = useAgents();
  const [editing, setEditing] = useState<TemplateView | "new" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <Stack spacing={1}>
      <Button size="small" variant="outlined" startIcon={<Add />} sx={{ alignSelf: "flex-end" }} onClick={() => setEditing("new")}>
        Add a template
      </Button>
      <List dense aria-label="Templates">
        {view.templates.length === 0 && (
          <ListItem disableGutters>
            <ListItemText secondary="No template yet. Add one to start internal agents from." />
          </ListItem>
        )}
        {view.templates.map((template) => (
          <ListItem
            key={template.id}
            disableGutters
            secondaryAction={
              <>
                <IconButton size="small" aria-label={`Change ${template.name}`} onClick={() => setEditing(template)}>
                  <Edit fontSize="small" />
                </IconButton>
                <IconButton size="small" aria-label={`Remove ${template.name}`} onClick={() => client.removeTemplate(template.id).then(() => setProblem(null), (error: unknown) => setProblem(errorText(error)))}>
                  <Delete fontSize="small" />
                </IconButton>
              </>
            }
          >
            <ListItemText primary={template.name} secondary={`${template.model} · ${template.endpoint}${template.hasKey ? "" : " · no key"}`} />
          </ListItem>
        ))}
      </List>
      {problem != null && (
        <Typography color="error" variant="body2">
          {problem}
        </Typography>
      )}
      {editing != null && (
        <TemplateForm
          initial={editing === "new" ? null : editing}
          onSave={(template) => (editing === "new" ? client.addTemplate(template) : client.changeTemplate(editing.id, template))}
          onClose={() => setEditing(null)}
        />
      )}
    </Stack>
  );
}

/** The archived agents, shown when the spec owner asks, each with a way to restore it. */
function ArchivedAgents({ onProblem }: { onProblem: (problem: string | null) => void }) {
  const { client, view } = useAgents();
  const [shown, setShown] = useState(false);
  const archived = view.agents.filter((agent) => agent.archived);
  if (archived.length === 0) return null;
  return (
    <Stack spacing={0.5}>
      <Button size="small" sx={{ alignSelf: "flex-start" }} onClick={() => setShown((was) => !was)} aria-expanded={shown}>
        {shown ? "Hide archived agents" : `Show archived agents (${archived.length})`}
      </Button>
      {shown && (
        <List dense aria-label="Archived agents">
          {archived.map((agent) => (
            <ListItem
              key={agent.id}
              disableGutters
              secondaryAction={
                <Tooltip title={`Restore ${agent.name}`}>
                  <IconButton size="small" aria-label={`Restore ${agent.name}`} onClick={() => client.restoreAgent(agent.id).then(() => onProblem(null), (error: unknown) => onProblem(errorText(error)))}>
                    <Unarchive fontSize="small" />
                  </IconButton>
                </Tooltip>
              }
            >
              <ListItemText primary={agent.name} secondary={agent.kind === "internal" ? `Internal agent · ${agent.template?.name}` : "Coding agent"} />
            </ListItem>
          ))}
        </List>
      )}
    </Stack>
  );
}

/** The agents the list shows: every agent not archived that has a name, and each connected coding agent that has none. */
export function listedAgents(agents: readonly AgentView[]): AgentView[] {
  return agents.filter((agent) => !agent.archived && (agent.name != null || (agent.kind === "coding" && agent.connected)));
}

/** A tab of the dialog that another module adds, such as the agent of each module. */
export interface AgentsTab {
  label: string;
  content: ReactNode;
}

/** The label above a group of agents. */
function GroupLabel({ text }: { text: string }) {
  return (
    <Typography variant="overline" color="text.secondary" sx={{ flexGrow: 1, lineHeight: 1.5 }}>
      {text}
    </Typography>
  );
}

/** Agents as cards of one size, in a grid that fits as many columns as the width allows. */
function AgentGrid({ label, agents, onProblem }: { label: string; agents: readonly AgentView[]; onProblem: (problem: string | null) => void }) {
  if (agents.length === 0) return null;
  return (
    <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: `repeat(auto-fill, ${CARD_WIDTH}px)` }} aria-label={label} role="list">
      {agents.map((agent) => (
        <Box key={agent.id} role="listitem">
          <AgentCard agent={agent} onProblem={onProblem} />
        </Box>
      ))}
    </Box>
  );
}

/**
 * The agents as cards, those connected first and, after a separator, the
 * coding agents not connected; with a way to start an internal agent from
 * a template on request and the archived agents on request.
 */
function AgentsTabContent() {
  const { view } = useAgents();
  const [problem, setProblem] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const agents = listedAgents(view.agents);
  // Internal agents count as connected: Requireganizer runs them itself.
  const reachable = agents.filter((agent) => agent.kind === "internal" || agent.connected);
  const unconnected = agents.filter((agent) => agent.kind === "coding" && !agent.connected);
  const noTemplate = view.templates.length === 0;
  return (
    <Stack spacing={1.5}>
      <Stack direction="row" sx={{ alignItems: "center", gap: 1, minHeight: 32 }}>
        <GroupLabel text={agents.length === 0 ? "No agent yet. Start one, or connect a coding agent over MCP." : `Connected · ${reachable.length}`} />
        <Tooltip title={noTemplate ? "Add a template first, in Templates." : ""}>
          <span>
            <Button size="small" startIcon={<Add />} disabled={noTemplate} onClick={() => setStarting((was) => !was)} aria-expanded={starting}>
              Start an internal agent
            </Button>
          </span>
        </Tooltip>
      </Stack>
      {starting && !noTemplate && (
        <Card variant="outlined" sx={{ p: 1.5 }}>
          <StartAgentForm templates={view.templates} />
        </Card>
      )}
      <AgentGrid label="Connected agents" agents={reachable} onProblem={setProblem} />
      {unconnected.length > 0 && (
        <>
          <Box sx={{ pt: 1.5 }}>
            <GroupLabel text={`Not connected · ${unconnected.length}`} />
          </Box>
          <AgentGrid label="Agents not connected" agents={unconnected} onProblem={setProblem} />
        </>
      )}
      {problem != null && (
        <Typography color="error" variant="body2">
          {problem}
        </Typography>
      )}
      <ArchivedAgents onProblem={setProblem} />
    </Stack>
  );
}

/**
 * The agents, each tab its own concern: the agents as cards, the tabs other
 * modules add, such as the agent of each module, and the templates internal
 * agents start from. A fixed height, so switching tabs never resizes it.
 */
export default function AgentsDialog({ open, onClose, tabs = [] }: { open: boolean; onClose: () => void; tabs?: readonly AgentsTab[] }) {
  const [shown, setShown] = useState(0);
  const all: AgentsTab[] = [{ label: "Agents", content: <AgentsTabContent /> }, ...tabs, { label: "Templates", content: <TemplateList /> }];
  const current = Math.min(shown, all.length - 1);
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md" slotProps={{ paper: { sx: { height: "min(85vh, 760px)" } } }}>
      <DialogTitle sx={{ pb: 0 }}>Agents</DialogTitle>
      <Tabs value={current} onChange={(_event, value: number) => setShown(value)} sx={{ px: 3, borderBottom: 1, borderColor: "divider" }}>
        {all.map(({ label }) => (
          <Tab key={label} label={label} />
        ))}
      </Tabs>
      <DialogContent sx={{ pt: 2 }}>
        <Box sx={{ pt: 2 }}>{all[current]!.content}</Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
