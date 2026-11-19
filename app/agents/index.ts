// The Agents module: the agents that work on the spec through the agent
// interface, whether Requireganizer runs them or they connect over MCP, and
// the requests the spec owner gives them. The MCP transport, which needs
// Node, is imported from "agents/mcp/server" by server entry points only.
export { AgentsClient, type AgentsRequest, type Confirmer, storeActionName } from "./client";
export { type Finding, findingsOf, type RequestKind, threadAsks } from "./annotations";
export { type AgentNotice, AgentDesk, type AgentWrite, type DeskView, type FindingView, type RequestNote, RequestsConcernedError, type RequestState, type SpecOwnerAction } from "./desk";
export {
  type AgentCaller,
  agentToolChange,
  agentToolDescriptions,
  type AgentToolDescription,
  callAgentTool,
  type OpenModule,
  type OtherModule,
  type PointedUnit,
  readToolDescriptions,
} from "./interface/tools";
export { type AiProvider, browserRunAgents, type RunAgent, type RunAgentsSource } from "./internal/runAgents";
export { type AgentsHostApi, type AgentsHostEvent, AgentsHost, requestModules, requestModulesOfState } from "./host";
export { type RequestEnd, type RequestRecord, type RunLog, type RunLogEntry } from "./record";
export { type AgentRequest, type RequestModule, requestSummary, stagesToAskAfter, waitingRequests } from "./requests";
export { type AgentId, AgentRoster, type AgentView, codingAgentId } from "./roster";
export { type AttentionOffer, parseOffers, type PointedPlace } from "./pointers";
