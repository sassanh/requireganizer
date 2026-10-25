import type { AgentTool } from "@earendil-works/pi-agent-core";

import { UserFacingError } from "lib/errors";
import type { Store } from "store";

import { workflowStageOf } from "./command";
import { buildReadTools, reviewerRejections } from "./read-tools";
import { buildStageSubmissionTools } from "./result-tools";
import { reviewerModel } from "./settings";

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
 * What an outside agent works on: the module the person has open, named
 * while the project has modules.
 */
export interface OpenModule {
  moduleName?: string;
}

/** The built-in agent's read tools, which an outside agent can call in every state of the project. */
export function readToolDescriptions(store: Store, open: OpenModule = {}): AgentToolDescription[] {
  return buildReadTools(store, open).map(describe);
}

/**
 * The tools an outside agent works with on an open project: the read tools
 * and the submission tool of every stage that can take work now. Approving
 * stays with the person, so no tool approves.
 */
export function agentToolDescriptions(store: Store, open: OpenModule = {}): AgentToolDescription[] {
  return [
    ...readToolDescriptions(store, open),
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
  open: OpenModule = {},
): Promise<string> {
  const read = buildReadTools(store, open).find((tool) => tool.name === name);
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
      const step = workflowStageOf(submission.stage);
      const stage = store.stageLabel(step);
      // No submission runs while a change waits, so a waiting one is this one.
      if (store.pendingImpactChange != null) {
        return `Not applied yet: the proposal sends the workflow back to ${stage}, so it waits until the person confirms that in Requireganizer.`;
      }
      const items = (count: number) => (count === 1 ? "one item" : `${count} items`);
      const lines = [
        `Applied to ${stage}. The person approves it in Requireganizer; get_workflow_state shows what still awaits approval.`,
      ];
      const rejections = reviewerRejections(store, step);
      if (rejections.length > 0) {
        lines.push(
          `The reviewer model rejected ${items(rejections.length)}. Fix what it names and submit the stage again, or leave it to the person, who can overrule it:`,
          ...rejections.map(({ unitId, reason }) => `- ${unitId}: ${reason}`),
        );
      }
      // The review runs within the submission, so what it left without a verdict it could not review.
      const unreviewed = reviewerModel() == null ? 0 : store.unitsAwaitingReview(step).length;
      if (unreviewed > 0) {
        lines.push(
          `The reviewer model could not review ${items(unreviewed)}. Tell the person, who can run the review again in Requireganizer.`,
        );
      }
      return lines.join("\n");
    }
  }
}
