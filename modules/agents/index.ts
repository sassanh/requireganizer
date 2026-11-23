// The Agents module: the internal agents Requireganizer runs and the coding
// agents that connect over MCP, each known by a name of its own until it is
// archived, and the agent interface every agent reaches the project's work
// through. The MCP transport and the file of templates, which need Node,
// are imported from "agents/mcp/server" and "agents/internal/fileTemplates"
// by server entry points only.
export { type ActionGate, AgentsClient, type AgentsRequest } from "./client";
export { type AgentsHostApi, type AgentsHostEvent, AgentsHost, type AgentsSession, type ArchiveGuard } from "./host";
export { type AgentToolDescription, type WorkInterface } from "./interface";
export { type RunOutcome, type RunRequest } from "./internal/runner";
export { type AgentId, type ConnectionDetails, type ContextPart, type ContextTopic } from "./record";
export { type AgentCaller, type AgentNotice, type CallingAgent, NAME_TOOL, type Registration } from "./registry";
export { browserTemplates, type Template, type TemplateDraft, type TemplatesSource, type TemplateView } from "./templates";
export { agentLabel, type AgentsView, type AgentView, EMPTY_AGENTS_VIEW, labelOfId, labelOfName, sameName } from "./view";
