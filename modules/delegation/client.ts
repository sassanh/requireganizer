import { UserFacingError } from "lib/errors";

import { type ConfirmationNote, ConfirmationNeededError, type WaitingThreadState } from "./desk";
import { type AssignTarget, type DelegationHostApi, type DelegationHostEvent, type DelegationView, EMPTY_DELEGATION_VIEW } from "./host";
import type { ReplyChange } from "./record";

/** How a client sends one of Delegation's calls to its host. */
export type DelegationRequest = <Name extends keyof DelegationHostApi>(
  name: Name,
  ...args: Parameters<DelegationHostApi[Name]>
) => Promise<Awaited<ReturnType<DelegationHostApi[Name]>>>;

/** What the spec owner is asked to confirm before an action: the threads whose agents it stops, and each note. */
export interface ConfirmationRequest {
  action: string;
  threads: readonly WaitingThreadState[];
  notes: readonly ConfirmationNote[];
}

/** Asks the spec owner to confirm; resolves to the keys of what they confirmed, or null to give the action up. */
export type Confirmer = (request: ConfirmationRequest) => Promise<string[] | null>;

/** What a store action of the spec owner's does, as a confirmation names it. */
const STORE_ACTION_NAMES: Partial<Record<string, string>> = {
  writeItems: "make the change",
  restoreSigned: "return to the signed version",
  resolveThread: "resolve the thread",
  replyAsSpecOwner: "send the message",
  messageUnit: "send the message",
  openStageThread: "send the message",
};

/** A store action as a confirmation names it. */
export function storeActionName(name: string): string {
  return STORE_ACTION_NAMES[name] ?? "carry it out";
}

/**
 * Delegation as a client of a project host holds it: the view the host
 * sends, the spec owner's actions on threads, and the confirmation they give
 * before an action that concerns threads agents have.
 */
export class DelegationClient {
  private view: DelegationView = EMPTY_DELEGATION_VIEW;
  private confirmer: Confirmer | null = null;

  constructor(
    private readonly request: DelegationRequest,
    /** Tell the client's subscribers that the view changed. */
    private readonly changed: () => void,
  ) {}

  getView = (): DelegationView => this.view;

  receive(event: DelegationHostEvent): void {
    this.view = event.view;
    this.changed();
  }

  /** Let the page ask the spec owner to confirm. */
  setConfirmer = (confirmer: Confirmer | null): void => {
    this.confirmer = confirmer;
  };

  /**
   * Carry out an action the host refuses until the spec owner confirms what
   * it concerns: ask them, then send it again with what they confirmed.
   * Rejects when they give it up.
   */
  confirmed = async <Value>(action: string, send: (confirmed?: string[]) => Promise<Value>): Promise<Value> => {
    try {
      return await send();
    } catch (error) {
      if (!(error instanceof ConfirmationNeededError) || this.confirmer == null) throw error;
      const confirmed = await this.confirmer({ action, threads: error.threads, notes: error.notes });
      if (confirmed == null) throw new UserFacingError(`Gave up: ${action}.`);
      return send(confirmed);
    }
  };

  assignThread = (key: string, target: AssignTarget): Promise<void> => this.confirmed("assign the thread", (confirmed) => this.request("assignThread", key, target, confirmed));

  stopAgents = (keys: string[]): Promise<void> => this.request("stopAgents", keys);

  continueThread = (key: string): Promise<void> => this.request("continueThread", key);

  withdrawThread = (key: string): Promise<void> => this.request("withdrawThread", key);

  askToUpdate = (moduleId: string, stages: string[], target: AssignTarget | null): Promise<void> =>
    this.confirmed("ask for the update", (confirmed) => this.request("askToUpdate", moduleId, stages, target, confirmed));

  askToReview = (moduleId: string, stage: string, target: AssignTarget | null): Promise<void> =>
    this.confirmed("ask for the review", (confirmed) => this.request("askToReview", moduleId, stage, target, confirmed));

  setModuleAgent = (moduleId: string, agentId: string | null): Promise<void> => this.request("setModuleAgent", moduleId, agentId);

  readReplyChanges = (messageId: string): Promise<ReplyChange[]> => this.request("readReplyChanges", messageId);
}
