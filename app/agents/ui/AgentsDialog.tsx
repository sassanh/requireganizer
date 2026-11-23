"use client";

import { Add, Archive, Delete, Edit, InfoOutlined, Unarchive } from "@mui/icons-material";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { type FormEvent, type ReactNode, useState } from "react";

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

/** A section of the dialog: a title, a line saying what it is for, and its content. */
function Section({ title, purpose, children }: { title: string; purpose: string; children: ReactNode }) {
  return (
    <Stack component="section" aria-label={title} spacing={1}>
      <Stack>
        <Typography variant="subtitle1">{title}</Typography>
        <Typography variant="body2" color="text.secondary">
          {purpose}
        </Typography>
      </Stack>
      {children}
    </Stack>
  );
}

/** An info icon that shows a coding agent's connection details on hover, focus or click, leaving the list's layout as it is. */
function DetailsInfo({ agent }: { agent: AgentView }) {
  const [pinned, setPinned] = useState(false);
  const label = `What ${agentLabel(agent)}'s connection tells`;
  return (
    <Tooltip
      open={pinned || undefined}
      onClose={() => setPinned(false)}
      title={
        <Stack component="ul" sx={{ m: 0, pl: 2 }}>
          {detailLines(agent.details).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </Stack>
      }
    >
      <IconButton size="small" aria-label={label} onClick={() => setPinned((shown) => !shown)}>
        <InfoOutlined fontSize="small" />
      </IconButton>
    </Tooltip>
  );
}

/** A one-field form, sent with Enter, that names an agent that has no name, showing why a name is refused. */
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
    <Stack component="form" direction="row" onSubmit={submit} sx={{ gap: 1, alignItems: "flex-start" }}>
      <TextField size="small" label="Name this agent" value={name} onChange={(event) => setName(event.target.value)} error={problem != null} helperText={problem} />
      <Button type="submit" size="small">
        Name
      </Button>
    </Stack>
  );
}

/** One agent of the list: by its name, or as unnamed with a way to name it; its kind and whether it is connected; and its actions. */
function AgentRow({ agent, onProblem }: { agent: AgentView; onProblem: (problem: string | null) => void }) {
  const { client } = useAgents();
  const [showingContext, setShowingContext] = useState(false);
  const kind = agent.kind === "internal" ? `Internal agent · ${agent.template?.name}` : agent.connected ? "Coding agent · connected" : "Coding agent · not connected";
  const asked = agent.kind === "coding" && agent.name != null && !agent.letIn ? (agent.askingToLetIn ? " · asks to be let in" : " · not let in") : "";
  return (
    <ListItem
      disableGutters
      secondaryAction={
        <Stack direction="row" sx={{ alignItems: "center" }}>
          {agent.kind === "coding" && <DetailsInfo agent={agent} />}
          {agent.kind === "internal" && (
            <Button size="small" onClick={() => setShowingContext(true)}>
              Context
            </Button>
          )}
          {agent.name != null && (
            <Tooltip title={`Archive ${agent.name}`}>
              <IconButton size="small" aria-label={`Archive ${agent.name}`} onClick={() => client.archiveAgent(agent.id).then(() => onProblem(null), (error: unknown) => onProblem(errorText(error)))}>
                <Archive fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Stack>
      }
    >
      <Stack spacing={0.5} sx={{ pr: 16 }}>
        <ListItemText primary={agentLabel(agent)} secondary={`${kind}${asked}`} />
        {agent.name == null && <NameField agent={agent} />}
      </Stack>
      {showingContext && <ContextDialog agentId={agent.id} topic={null} onClose={() => setShowingContext(false)} />}
    </ListItem>
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
      <Button size="small" startIcon={<Add />} sx={{ alignSelf: "flex-start" }} onClick={() => setEditing("new")}>
        Add a template
      </Button>
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

/**
 * Every agent that is not archived, by its name, each connected coding
 * agent that has no name marked as unnamed, each coding agent not connected
 * marked so; a way to start an internal agent from a template; and the
 * templates.
 */
export default function AgentsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { view } = useAgents();
  const [problem, setProblem] = useState<string | null>(null);
  const agents = listedAgents(view.agents);
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Agents</DialogTitle>
      <DialogContent>
        <Stack spacing={3} divider={<Divider flexItem />}>
          <Section title="Your agents" purpose="The agents you can assign threads to: the internal agents you started and the coding agents that connected.">
            <List dense aria-label="Agents">
              {agents.length === 0 && (
                <ListItem disableGutters>
                  <ListItemText secondary="No agent yet. Start one below, or connect a coding agent over MCP." />
                </ListItem>
              )}
              {agents.map((agent) => (
                <AgentRow key={agent.id} agent={agent} onProblem={setProblem} />
              ))}
            </List>
            <ArchivedAgents onProblem={setProblem} />
            {problem != null && (
              <Typography color="error" variant="body2">
                {problem}
              </Typography>
            )}
          </Section>
          <Section
            title="Start an internal agent"
            purpose={view.templates.length === 0 ? "Add a template below first; an internal agent runs on a template's AI provider and model." : "Requireganizer runs it on the AI provider and model of the template you choose."}
          >
            <StartAgentForm templates={view.templates} />
          </Section>
          <Section title="Templates" purpose="Each template is an AI provider's OpenAI-compatible endpoint, a key and a model, for starting internal agents.">
            <TemplateList />
          </Section>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
