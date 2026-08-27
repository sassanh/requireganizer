import { canonicalJson, sha256Text } from "contract-domain";

/**
 * A timeline artifact hash: truncated sha256 (20 hex chars, 80 bits —
 * collision-safe at this scale), satisfying the max-20-char rule.
 */
export type Hash = string;

/** The store snapshot shape the timeline grammar understands. */
export type ProjectSnapshot = {
  schemaVersion: number;
  businessCounter: number;
  description: string;
  productOverview: unknown;
  userStories: unknown[];
  requirements: unknown[];
  acceptanceCriteria: unknown[];
  boundaryDesign: unknown;
  implementationProfile: unknown;
  contractSuite: unknown;
  testScenarios: unknown[];
  projectSetup: unknown;
  scaffoldFiles: unknown[];
  stageInputFingerprints: unknown;
  conversation: unknown[];
  // Ephemeral fields the timeline excludes; preserved across restores.
  // `isClean` is bookkeeping flipped by undeclared side paths (imports,
  // artifact setters) — treating it as history would phantom-step on every
  // reload.
  validationErrors?: string | null;
  systemMessage?: string | null;
  conversationSidebarOpen?: boolean;
  isClean?: boolean;
};

/** The store's data-structure tree with artifact leaves replaced by hashes. */
export type StateTree = {
  schemaVersion: number;
  businessCounter: number;
  description: Hash;
  productOverview: Hash | null;
  userStories: Hash[];
  requirements: Hash[];
  acceptanceCriteria: Hash[];
  boundaryDesign: Hash | null;
  implementationProfile: Hash | null;
  contractSuite: Hash | null;
  testScenarios: Hash[];
  projectSetup: Hash | null;
  scaffoldFiles: Hash[];
  stageInputFingerprints: Hash;
  conversation: Hash[];
};

/**
 * Content-addressed artifact store: an artifact's canonical JSON is written
 * only when its hash is unseen. Identical content anywhere in any node
 * resolves to the same hash and is stored exactly once.
 */
const artifactStore = new Map<Hash, string>();
const objectHashMemo = new WeakMap<object, Hash>();

export function hashArtifact(value: unknown): Hash {
  return sha256Text(canonicalJson(value)).slice(0, 20);
}

function putArtifact(value: unknown): Hash {
  if (value != null && typeof value === "object") {
    const memoized = objectHashMemo.get(value);
    if (memoized != null && artifactStore.has(memoized)) return memoized;
  }
  const hash = hashArtifact(value);
  if (!artifactStore.has(hash)) {
    artifactStore.set(hash, canonicalJson(value));
  }
  if (value != null && typeof value === "object") {
    objectHashMemo.set(value, hash);
  }
  return hash;
}

function resolveArtifact(hash: Hash | null): unknown {
  if (hash == null) return null;
  const json = artifactStore.get(hash);
  if (json == null) {
    throw new Error(`Timeline artifact ${hash} is missing from the object store.`);
  }
  return JSON.parse(json);
}

/** Mark-and-sweep: drop artifacts unreachable from the surviving nodes. */
export function collectArtifactGarbage(
  states: readonly StateTree[],
): void {
  const reachable = new Set<Hash>();
  const visit = (value: unknown): void => {
    if (typeof value === "string") {
      if (artifactStore.has(value)) reachable.add(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value != null && typeof value === "object") {
      Object.values(value).forEach(visit);
    }
  };
  states.forEach((state) => visit(state));
  for (const hash of artifactStore.keys()) {
    if (!reachable.has(hash)) artifactStore.delete(hash);
  }
}

/** True when the two state trees reference identical artifact sets. */
export function sameState(left: StateTree, right: StateTree): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function hashArray(values: readonly unknown[]): Hash[] {
  return values.map((value) => putArtifact(value));
}

/** Hash the store snapshot into a state tree, writing unseen artifacts. */
export function captureState(snapshot: ProjectSnapshot): StateTree {
  return {
    schemaVersion: snapshot.schemaVersion,
    businessCounter: snapshot.businessCounter,
    description: putArtifact(snapshot.description),
    productOverview: putArtifact(snapshot.productOverview),
    userStories: hashArray(snapshot.userStories),
    requirements: hashArray(snapshot.requirements),
    acceptanceCriteria: hashArray(snapshot.acceptanceCriteria),
    boundaryDesign: snapshot.boundaryDesign == null
      ? null
      : putArtifact(snapshot.boundaryDesign),
    implementationProfile: snapshot.implementationProfile == null
      ? null
      : putArtifact(snapshot.implementationProfile),
    contractSuite: snapshot.contractSuite == null
      ? null
      : putArtifact(snapshot.contractSuite),
    testScenarios: hashArray(snapshot.testScenarios),
    projectSetup: snapshot.projectSetup == null
      ? null
      : putArtifact(snapshot.projectSetup),
    scaffoldFiles: hashArray(snapshot.scaffoldFiles),
    stageInputFingerprints: putArtifact(snapshot.stageInputFingerprints),
    conversation: hashArray(snapshot.conversation),
  };
}

/** The recorded snapshot with artifacts resolved back to values — everything
 * ProjectSnapshot carries except the ephemeral fields restores take from the
 * live store. */
export type ResolvedState = Omit<
  ProjectSnapshot,
  "isClean" | "validationErrors" | "systemMessage" | "conversationSidebarOpen"
>;

/** Resolve a recorded state tree into artifact values, collection item by
 * collection item, so consumers can inspect identities (item ids) and
 * embedded structures rather than content hashes. */
export function resolveStateValues(state: StateTree): ResolvedState {
  return {
    schemaVersion: state.schemaVersion,
    businessCounter: state.businessCounter,
    description: resolveArtifact(state.description) as string,
    productOverview: resolveArtifact(state.productOverview),
    userStories: state.userStories.map(resolveArtifact),
    requirements: state.requirements.map(resolveArtifact),
    acceptanceCriteria: state.acceptanceCriteria.map(resolveArtifact),
    boundaryDesign: resolveArtifact(state.boundaryDesign),
    implementationProfile: resolveArtifact(state.implementationProfile),
    contractSuite: resolveArtifact(state.contractSuite),
    testScenarios: state.testScenarios.map(resolveArtifact),
    projectSetup: resolveArtifact(state.projectSetup),
    scaffoldFiles: state.scaffoldFiles.map(resolveArtifact),
    stageInputFingerprints: resolveArtifact(state.stageInputFingerprints),
    conversation: state.conversation.map(resolveArtifact),
  };
}

/**
 * Rebuild the original snapshot from a state tree. `current` supplies the
 * ephemeral UI fields the timeline excludes, so they survive undo/redo.
 */
export function restoreSnapshot(
  state: StateTree,
  current: ProjectSnapshot,
): ProjectSnapshot {
  return {
    ...resolveStateValues(state),
    isClean: current.isClean === true,
    validationErrors: current.validationErrors ?? null,
    systemMessage: current.systemMessage ?? null,
    conversationSidebarOpen: current.conversationSidebarOpen === true,
  };
}

/** Test/inspection helper: number of distinct artifacts currently stored. */
export function artifactCount(): number {
  return artifactStore.size;
}

/** The persisted form of the conversation tree + the artifact store. */
export type PersistedTimeline = {
  version: 2;
  rootId: string;
  activeLeafId: string;
  nodes: unknown[];
  artifacts: [Hash, string][];
};

export function exportTimelineData(
  payload: Omit<PersistedTimeline, "version" | "artifacts">,
): PersistedTimeline {
  return {
    version: 2,
    ...payload,
    artifacts: [...artifactStore.entries()],
  };
}

/**
 * Replace the artifact store with the persisted one and hand back the raw
 * payload. Throws on structurally malformed data — callers treat that as
 * "no timeline" and start fresh.
 */
export function importTimelineData(
  data: PersistedTimeline,
): { rootId: string; activeLeafId: string; nodes: unknown[] } {
  if (
    typeof data.rootId !== "string" ||
    typeof data.activeLeafId !== "string" ||
    !Array.isArray(data.nodes) ||
    data.nodes.length === 0 ||
    !Array.isArray(data.artifacts)
  ) {
    throw new Error("Malformed timeline payload.");
  }
  artifactStore.clear();
  for (const [hash, json] of data.artifacts) {
    if (typeof hash === "string" && typeof json === "string") {
      artifactStore.set(hash, json);
    }
  }
  // Earlier versions recorded ephemeral bookkeeping (`isClean`) inside node
  // states; strip it so stored histories compare cleanly against fresh
  // captures.
  for (const node of data.nodes) {
    const state = (node as { state?: unknown })?.state;
    if (state != null && typeof state === "object") {
      delete (state as Record<string, unknown>).isClean;
    }
  }
  return { rootId: data.rootId, activeLeafId: data.activeLeafId, nodes: data.nodes };
}
