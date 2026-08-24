import { canonicalJson, sha256Text } from "contract-domain";

/**
 * A timeline artifact hash: truncated sha256 (20 hex chars, 80 bits —
 * collision-safe at this scale), satisfying the max-20-char rule.
 */
export type Hash = string;

/** The store snapshot shape the timeline grammar understands. */
export type ProjectSnapshot = {
  schemaVersion: number;
  isClean: boolean;
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
  conversationBranches: unknown[];
  // Ephemeral fields the timeline excludes; preserved across restores.
  validationErrors?: string | null;
  systemMessage?: string | null;
  conversationSidebarOpen?: boolean;
};

/** The store's data-structure tree with artifact leaves replaced by hashes. */
export type TimelineNodeState = {
  schemaVersion: number;
  isClean: boolean;
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
  conversationBranches: Hash[];
};

export type TimelineNode = {
  id: string;
  label: string;
  source: "user" | "ai";
  createdAt: number;
  state: TimelineNodeState;
  conversation: { length: number; branchCount: number };
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
  nodes: readonly { state: TimelineNodeState }[],
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
  nodes.forEach((node) => visit(node.state));
  for (const hash of artifactStore.keys()) {
    if (!reachable.has(hash)) artifactStore.delete(hash);
  }
}

/** True when the two node states reference identical artifact sets. */
export function sameNodeState(
  left: TimelineNodeState,
  right: TimelineNodeState,
): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function hashArray(values: readonly unknown[]): Hash[] {
  return values.map((value) => putArtifact(value));
}

/** Capture the store snapshot as a timeline node (hash-referencing tree). */
export function captureNode(
  snapshot: ProjectSnapshot,
  meta: { id: string; label: string; source: "user" | "ai"; createdAt: number },
): TimelineNode {
  const state: TimelineNodeState = {
    schemaVersion: snapshot.schemaVersion,
    isClean: snapshot.isClean,
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
    conversationBranches: hashArray(snapshot.conversationBranches),
  };
  return {
    id: meta.id,
    label: meta.label,
    source: meta.source,
    createdAt: meta.createdAt,
    state,
    conversation: {
      length: snapshot.conversation.length,
      branchCount: snapshot.conversationBranches.length,
    },
  };
}

/**
 * Rebuild the original snapshot from a node. `current` supplies the
 * ephemeral UI fields the timeline excludes, so they survive undo/redo.
 */
export function restoreNode(
  node: TimelineNode,
  current: ProjectSnapshot,
): ProjectSnapshot {
  return {
    schemaVersion: node.state.schemaVersion,
    isClean: node.state.isClean,
    businessCounter: node.state.businessCounter,
    description: resolveArtifact(node.state.description) as string,
    productOverview: resolveArtifact(node.state.productOverview),
    userStories: node.state.userStories.map(resolveArtifact),
    requirements: node.state.requirements.map(resolveArtifact),
    acceptanceCriteria: node.state.acceptanceCriteria.map(resolveArtifact),
    boundaryDesign: resolveArtifact(node.state.boundaryDesign),
    implementationProfile: resolveArtifact(node.state.implementationProfile),
    contractSuite: resolveArtifact(node.state.contractSuite),
    testScenarios: node.state.testScenarios.map(resolveArtifact),
    projectSetup: resolveArtifact(node.state.projectSetup),
    scaffoldFiles: node.state.scaffoldFiles.map(resolveArtifact),
    stageInputFingerprints: resolveArtifact(node.state.stageInputFingerprints),
    conversation: node.state.conversation.map(resolveArtifact),
    conversationBranches: node.state.conversationBranches.map(resolveArtifact),
    validationErrors: current.validationErrors ?? null,
    systemMessage: current.systemMessage ?? null,
    conversationSidebarOpen: current.conversationSidebarOpen === true,
  };
}
/** Test/inspection helper: number of distinct artifacts currently stored. */
export function artifactCount(): number {
  return artifactStore.size;
}

/** The persisted form of a timeline: nodes + cursor + the artifact store. */
export type PersistedTimeline = {
  version: 1;
  cursor: number;
  nodes: TimelineNode[];
  artifacts: [Hash, string][];
};

export function exportTimelineData(
  nodes: readonly TimelineNode[],
  cursor: number,
): PersistedTimeline {
  return {
    version: 1,
    cursor,
    nodes: [...nodes],
    artifacts: [...artifactStore.entries()],
  };
}

/**
 * Replace the artifact store with the persisted one and return the restored
 * nodes and cursor. Throws on structurally malformed data — callers treat
 * that as "no timeline" and start fresh.
 */
export function importTimelineData(
  data: PersistedTimeline,
): { nodes: TimelineNode[]; cursor: number } {
  if (
    !Array.isArray(data.nodes) ||
    !Array.isArray(data.artifacts) ||
    typeof data.cursor !== "number" ||
    !Number.isInteger(data.cursor) ||
    data.cursor < 0
  ) {
    throw new Error("Malformed timeline payload.");
  }
  const validNode = (node: unknown): node is TimelineNode => {
    if (node == null || typeof node !== "object") return false;
    const candidate = node as Partial<TimelineNode>;
    return (
      typeof candidate.id === "string" &&
      typeof candidate.label === "string" &&
      (candidate.source === "user" || candidate.source === "ai") &&
      typeof candidate.createdAt === "number" &&
      candidate.state != null &&
      typeof candidate.state === "object" &&
      Array.isArray(candidate.state.conversation) &&
      Array.isArray(candidate.state.conversationBranches)
    );
  };
  const nodes = data.nodes.filter(validNode);
  if (nodes.length === 0) throw new Error("Timeline payload has no nodes.");

  artifactStore.clear();
  for (const [hash, json] of data.artifacts) {
    if (typeof hash === "string" && typeof json === "string") {
      artifactStore.set(hash, json);
    }
  }
  const cursor = Math.min(Math.max(data.cursor, 0), nodes.length - 1);
  return { nodes, cursor };
}
