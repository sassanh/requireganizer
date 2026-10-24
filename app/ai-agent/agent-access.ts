import type { AgentTool } from "@earendil-works/pi-agent-core";

import { UserFacingError } from "lib/errors";
import type { Store } from "store";

import { workflowStageOf } from "./command";
import { buildReadTools } from "./read-tools";
import { buildStageSubmissionTools } from "./result-tools";

/** A tool an outside agent can call, as a tool protocol lists it. */
export interface AgentToolDescription {
  name: string;
  description: string;
  /** JSON Schema of the tool's arguments: always an object schema. */
  inputSchema: Record<string, unknown>;
}

function describe(tool: AgentTool): AgentToolDescription {
  return {
    name: tool.name,
    description: tool.description,
    // The schema builders tag their output with symbols; only the JSON is the schema.
    inputSchema: JSON.parse(JSON.stringify(tool.parameters)) as Record<string, unknown>,
  };
}

function resultText(result: Awaited<ReturnType<AgentTool["execute"]>>): string {
  return result.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
}

/**
 * The tools an outside agent works with: the built-in agent's read tools and
 * the submission tool of every stage that can take work now. Approving stays
 * with the person, so no tool approves.
 */
export function agentToolDescriptions(store: Store): AgentToolDescription[] {
  return [
    ...buildReadTools(store).map(describe),
    ...buildStageSubmissionTools(store).map(({ tool }) => describe(tool)),
  ];
}

/**
 * Run one tool for an outside agent. Reads answer at once; a submission runs
 * as its own flow, so it is gated, recorded and reviewed like the built-in
 * agent's work. Throws a message the agent can act on when the call fails.
 */
export async function callAgentTool(
  store: Store,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const read = buildReadTools(store).find((tool) => tool.name === name);
  if (read != null) return resultText(await read.execute(name, args as never));

  const submission = buildStageSubmissionTools(store).find(({ tool }) => tool.name === name);
  if (submission == null) {
    throw new UserFacingError(
      `No tool named ${name} is available now. A stage's submission tool appears once its earlier stages are approved.`,
    );
  }
  const outcome = await store.submitAgentProposal(submission.stage, name, args);
  switch (outcome.status) {
    case "busy":
      throw new UserFacingError(
        `Requireganizer is busy${store.thinkingLabel == null ? "" : ` (${store.thinkingLabel})`}. Try again when it finishes.`,
      );
    case "aborted":
      throw new UserFacingError("The person stopped the submission in Requireganizer.");
    case "failed":
      throw new UserFacingError(outcome.message);
    case "completed": {
      const stage = store.stageLabel(workflowStageOf(submission.stage));
      // No submission runs while a change waits, so a waiting one is this one.
      if (store.pendingImpactChange != null) {
        return `Not applied yet: the proposal sends the workflow back to ${stage}, so it waits until the person confirms that in Requireganizer.`;
      }
      return `Applied to ${stage}. The person approves it in Requireganizer; get_workflow_state shows what still awaits approval.`;
    }
  }
}
