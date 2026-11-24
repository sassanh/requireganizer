// The Delegation module: the threads the spec owner assigns to the agents
// they choose, and the work agents do on the spec through the agent
// interface the Agents module serves.
export { type AssignTarget, type DelegationHostApi, type DelegationHostEvent, DelegationHost, type DelegationView, EMPTY_DELEGATION_VIEW, type NoteView, type ProposalView, type ReplacingAction, type StageAsks, type WaitingView } from "./host";
export { type ConfirmationRequest, type Confirmer, DelegationClient, type DelegationRequest, storeActionName } from "./client";
export { type ConfirmationNote, ConfirmationNeededError, type WaitingThreadState } from "./desk";
export { type AttentionOffer, parseOffers, type PointedPlace } from "./pointers";
