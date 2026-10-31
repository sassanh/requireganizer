import type { AgentTool } from "@earendil-works/pi-agent-core";

import { UserFacingError } from "lib/errors";
import { isRecord } from "lib/json";
import type { Store } from "store";
import { OVERVIEW_PURPOSE_QUALITY_ID } from "store/constants";
import type { ListChange } from "store/listChange";
import type { ThreadAnswer } from "store/threads";

import { workflowStageOf } from "./command";
import { buildReadTools, excerpt, reviewerRejections } from "./read-tools";
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

/**
 * What one submission did to its list, each item by code and the start of
 * its text. `change.dropped` holds every item awaiting removal, so the ones
 * that awaited it before this submission are not its doing; one it lists
 * again has its removal withdrawn.
 */
function listChangeLines(store: Store, change: ListChange, pendingBefore: ReadonlySet<string>): string[] {
  const named = (id: string) => {
    const text = store.structuralFragmentsCache[id]?.content ?? (id === OVERVIEW_PURPOSE_QUALITY_ID ? store.productOverview.purpose : "");
    return `- ${store.unitLabel(id)}: ${excerpt(text)}`;
  };
  const section = (heading: string, ids: string[]) => (ids.length === 0 ? [] : [heading, ...ids.map(named)]);
  return [
    ...section("Added:", change.added),
    ...section("Changed:", change.changed),
    ...section("Proposed for removal:", change.dropped.map(({ id }) => id).filter((id) => !pendingBefore.has(id))),
    ...section("Removal withdrawn:", [...pendingBefore].filter((id) => store.reviewUnit(id)?.pendingRemoval === false)),
  ];
}

function resultText(result: Awaited<ReturnType<AgentTool["execute"]>>): string {
  return result.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
}

/**
 * What an outside agent works on: the module the person has open, named
 * while the project has modules, and then how to add one.
 */
export interface OpenModule {
  moduleName?: string;
  addModule?: (name: string) => void;
}

/** The outside agent calling: the name it gave when it connected. */
export interface AgentCaller {
  name: string;
  /** The connection it calls through, set by the host; what the agent takes up ends with it. */
  connection?: string;
}

/** Reading a thread with it, while the coding agent answers, takes the thread up. */
const THREAD_TOOL_NAME = "get_thread";

const REPLY_TOOL_NAME = "reply_to_thread";

/** Listed while the coding agent answers change requests. */
const REPLY_TOOL: AgentToolDescription = {
  name: REPLY_TOOL_NAME,
  description:
    "Reply to one of the person's open threads without changing work, such as to ask what they mean or to say why the unit should stay as it is. To answer with a change, submit the unit's stage and name the thread in the submission's answers. Only the person resolves a thread.",
  inputSchema: {
    type: "object",
    properties: {
      threadId: { type: "string", description: "The thread to reply to, from get_workflow_state or get_thread." },
      text: { type: "string", minLength: 1, description: "The reply the person reads." },
    },
    required: ["threadId", "text"],
    additionalProperties: false,
  },
};

const CREATE_MODULE_TOOL_NAME = "create_module";

/** Listed while the project has modules. */
const CREATE_MODULE_TOOL: AgentToolDescription = {
  name: CREATE_MODULE_TOOL_NAME,
  description:
    "Create a module the person asked for. It opens at once in Requireganizer, empty at its Module Overview, and every tool then works on it.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", minLength: 1, description: "The module's name, as the person gave it." },
    },
    required: ["name"],
    additionalProperties: false,
  },
};

const ANSWERS_PROPERTY = {
  type: "array",
  description:
    "The open threads of this stage that the submission answers, each with a reply telling the person what changed. get_workflow_state lists them.",
  items: {
    type: "object",
    properties: {
      threadId: { type: "string" },
      reply: { type: "string", minLength: 1 },
    },
    required: ["threadId", "reply"],
    additionalProperties: false,
  },
};

function withAnswers(description: AgentToolDescription): AgentToolDescription {
  const properties = (description.inputSchema.properties ?? {}) as Record<string, unknown>;
  return {
    ...description,
    inputSchema: { ...description.inputSchema, properties: { ...properties, answers: ANSWERS_PROPERTY } },
  };
}

function parseAnswers(value: unknown): ThreadAnswer[] {
  if (value == null) return [];
  if (
    !Array.isArray(value) ||
    !value.every((entry) => isRecord(entry) && typeof entry.threadId === "string" && typeof entry.reply === "string")
  ) {
    throw new UserFacingError("answers must be a list of { threadId, reply }.");
  }
  return value.map(({ threadId, reply }: { threadId: string; reply: string }) => ({ threadId, text: reply }));
}

function stringArgument(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  if (typeof value !== "string") throw new UserFacingError(`${name} must be a string.`);
  return value;
}

/** The built-in agent's read tools, which an outside agent can call in every state of the project. */
export function readToolDescriptions(store: Store, open: OpenModule = {}): AgentToolDescription[] {
  return buildReadTools(store, open).map(describe);
}

/**
 * The tools an outside agent works with on an open project: the read tools
 * and the submission tool of every stage that can take work now, while it
 * answers the person's change requests the tools that answer them, and
 * while the project has modules the one that adds a module.
 * Approving and resolving stay with the person, so no tool does either.
 */
export function agentToolDescriptions(store: Store, open: OpenModule = {}): AgentToolDescription[] {
  const answers = store.threadAnswerer === "coding-agent";
  const submissions = buildStageSubmissionTools(store).map(({ tool }) => describe(tool));
  return [
    ...readToolDescriptions(store, open),
    ...(answers ? submissions.map(withAnswers) : submissions),
    ...(answers ? [REPLY_TOOL] : []),
    ...(open.addModule == null ? [] : [CREATE_MODULE_TOOL]),
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
  caller: AgentCaller = { name: "The coding agent" },
): Promise<string> {
  const read = buildReadTools(store, open).find((tool) => tool.name === name);
  if (read != null) {
    const text = resultText(await read.execute(name, args as never));
    if (name === THREAD_TOOL_NAME && store.threadAnswerer === "coding-agent") {
      store.takeUpThread(stringArgument(args, "threadId"), caller.connection ?? caller.name);
    }
    return text;
  }

  const author = { kind: "agent" as const, name: caller.name };
  if (name === REPLY_TOOL_NAME) {
    store.answerThreads(
      [{ threadId: stringArgument(args, "threadId"), text: stringArgument(args, "text") }],
      author,
    );
    return "Replied. The thread waits for the person.";
  }

  if (name === CREATE_MODULE_TOOL_NAME && open.addModule != null) {
    open.addModule(stringArgument(args, "name"));
    return "Created the module; it is now the one the person has open. Call get_workflow_state before working on it.";
  }

  const submission = buildStageSubmissionTools(store).find(({ tool }) => tool.name === name);
  if (submission == null) {
    throw new UserFacingError(
      `No tool named ${name} is available now. A stage's submission tool appears once its earlier stages are approved.`,
    );
  }
  const { answers: answersArgument, ...proposal } = args;
  const answers = parseAnswers(answersArgument);
  const listChangeBefore = store.stageListChange(workflowStageOf(submission.stage));
  const pendingBefore = new Set(store.stageUnits(workflowStageOf(submission.stage))
    .filter(({ pendingRemoval }) => pendingRemoval).map(({ id }) => id));
  const codesVersionBefore = store.codesVersion;
  const outcome = await store.submitAgentProposal(submission.stage, name, proposal, answers, caller.name);
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
      const items = (count: number) => (count === 1 ? "one item" : `${count} items`);
      const lines = [
        `Applied to ${stage}. The person approves it in Requireganizer; get_workflow_state shows what still awaits approval.`,
        ...(answers.length > 0
          ? [`Replied to ${answers.length === 1 ? "one thread" : `${answers.length} threads`}; the person reads the replies and resolves the threads.`]
          : []),
      ];
      // Only a submission of listed items records a list change; another stage keeps the one before.
      const listChange = store.stageListChange(step);
      if (listChange != null && listChange !== listChangeBefore) lines.push(...listChangeLines(store, listChange, pendingBefore));
      if (store.codesVersion !== codesVersionBefore) {
        lines.push(`Codes may have moved (codesVersion ${store.codesVersion}): read get_items again before naming items.`);
      }
      const rejections = reviewerRejections(store, step);
      if (rejections.length > 0) {
        lines.push(
          `The reviewer model rejected ${items(rejections.length)}. Fix what it names and submit the stage again, or leave it to the person, who can overrule it:`,
          ...rejections.map(({ unit, reason }) => `- ${unit}: ${reason}`),
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
