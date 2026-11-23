import type { CallingAgent } from "./registry";

/** A tool of the agent interface, as a tool protocol lists it. */
export interface AgentToolDescription {
  name: string;
  description: string;
  /** JSON Schema of the tool's arguments: always an object schema. */
  inputSchema: Record<string, unknown>;
}

/**
 * The work agents do on the project through the agent interface, which
 * another module provides: the Agents module serves it to every agent, and
 * lets a call through only once it knows the agent calling and that agent
 * may call.
 */
export interface WorkInterface {
  /** The tools an agent can call on the project now. */
  tools(): AgentToolDescription[];
  /** Run one of those tools for an agent; resolves to its text result, or rejects with what the agent can act on. */
  call(name: string, args: Record<string, unknown>, agent: CallingAgent): Promise<string>;
  /** What every agent is told of that work as it connects, or as it is started. */
  instructions(): string;
}
