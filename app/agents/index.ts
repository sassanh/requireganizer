// The Agents module: the agents that work on the spec through the agent
// interface, whether Requireganizer runs them or they connect over MCP, and
// the threads the spec owner assigns them. The MCP transport, which needs
// Node, is imported from "agents/mcp/server" by server entry points only.
export { AgentsClient, type AgentsRequest, type Confirmer, storeActionName } from "./client";
export { type AskKind, type Finding, findingsOf, threadAsks } from "./annotations";
export {
  type AgentNotice,
  AgentDesk,
  type AgentWrite,
  type DeskView,
  type FindingView,
  type SpecOwnerAction,
  ThreadsConcernedError,
  type WaitingThreadState,
  type WaitNote,
} from "./desk";
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
export { type AgentsHostApi, type AgentsHostEvent, AgentsHost, projectModules, projectModulesOfState } from "./host";
export { type RunLog, type RunLogEntry, type WaitEnd, type WaitRecord } from "./record";
export { type ProjectModule, stagesToAskAfter, threadSummary, type WaitingThread, waitingThreads } from "./waiting";
export { type AgentId, AgentRoster, type AgentView, codingAgentId } from "./roster";
export { type AttentionOffer, parseOffers, type PointedPlace } from "./pointers";
