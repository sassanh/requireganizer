export type JsonPrimitive = string | number | boolean | null;

export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonSchema = boolean | { [key: string]: JsonValue | undefined };

export type ApprovalStatus = "draft" | "approved";

/** Who gave an approval: a person, or the reviewer model by name. */
export type Reviewer = { kind: "person" } | { kind: "model"; model: string };

export type VerdictDecision = "approve" | "reject";

/** The reviewer model's verdict on one exact state of a reviewable unit. */
export interface ModelVerdict {
  /** The unit's checked hash the verdict was given on. */
  checked: string;
  verdict: VerdictDecision;
  reason: string;
  model: string;
  at: string;
}

/**
 * What was checked, who checked it, and when. A unit is approved only while
 * `checked` equals the unit's current checked hash; the record outlives
 * changes as the signed version a rewrite can be restored to.
 */
export interface Signature {
  checked: string;
  /** The approved content, for word diffs and restore. Null when the unit restores nothing. */
  signed: JsonValue | null;
  reviewer: Reviewer;
  at: string;
  /** The model verdict a person decided against, kept with the decision. */
  overruled?: Omit<ModelVerdict, "checked" | "at">;
  /**
   * For a list item: the hash of its stage's inputs when it was approved.
   * An approval given before the inputs changed is what impact review
   * confirms; it is not part of what was checked.
   */
  inputs?: string;
}

export interface RevisionMetadata {
  id: string;
  revisionId: string;
  revision: number;
  createdAt: string;
  signature?: Signature | null;
  verdict?: ModelVerdict | null;
}

export type SubjectClassification = "external" | "internal" | "composite";
export type SubjectLifecycle = "fresh_per_case";
export type InterfaceVisibility = "external" | "internal";
export type InterfaceDirection =
  | "inbound"
  | "outbound"
  | "bidirectional";
export type InteractionStyle =
  | "request_response"
  | "command"
  | "query"
  | "event"
  | "stream"
  | "interactive";

export interface TestSubject {
  id: string;
  name: string;
  purpose: string;
  classification: SubjectClassification;
  parentSubjectId: string | null;
  responsibilities: string[];
  exclusions: string[];
  lifecycle: SubjectLifecycle;
  requirementIds: string[];
  acceptanceCriteriaIds: string[];
}

export interface SemanticInterface {
  id: string;
  subjectId: string;
  name: string;
  peer: string;
  visibility: InterfaceVisibility;
  direction: InterfaceDirection;
  interactionStyle: InteractionStyle;
  interactionIds: string[];
}

export interface SemanticInteraction {
  id: string;
  interfaceId: string;
  name: string;
  intent: string;
  inputDescription: string;
  outputDescription: string;
  failureDescriptions: string[];
  stateEffects: string[];
  requirementIds: string[];
  acceptanceCriteriaIds: string[];
}

export type VerificationKind =
  | "performance"
  | "security"
  | "accessibility"
  | "compatibility"
  | "static_analysis"
  | "manual_evidence";

export interface VerificationObligation {
  id: string;
  name: string;
  kind: VerificationKind;
  description: string;
  requirementIds: string[];
  acceptanceCriteriaIds: string[];
}

export type CoverageTargetType = "interaction" | "verification_obligation";

export interface AcceptanceCoverage {
  acceptanceCriteriaId: string;
  targetType: CoverageTargetType;
  targetId: string;
}

export interface BoundaryDesign extends RevisionMetadata {
  requirementsRevisionId: string;
  acceptanceCriteriaRevisionId: string;
  rootSubjectId: string;
  subjects: TestSubject[];
  interfaces: SemanticInterface[];
  interactions: SemanticInteraction[];
  verificationObligations: VerificationObligation[];
  coverage: AcceptanceCoverage[];
}

export interface ImplementationProfile extends RevisionMetadata {
  boundaryRevisionId: string;
  platform: string;
  runtime: string;
  language: string;
  framework: string;
  moduleSystem: string;
  buildEcosystem: string;
  testEcosystem: string;
  constraints: string[];
}

export interface AdapterToolSchemas {
  formalContract: JsonSchema;
  traceEvent: JsonSchema;
}

export interface AdapterProgram {
  id: string;
  version: string;
  notation: string;
  rationale: string;
  formalizationInstructions: string[];
  revisionInstructions: string[];
  toolSchemas: AdapterToolSchemas;
}

export interface NativeContractDocument {
  path: string;
  mediaType: string;
  content: string;
  sha256: string;
}

export interface FormalInterfaceContract {
  format: string;
  summary: string;
  documents: NativeContractDocument[];
  neutralManifest: JsonValue | null;
}

export interface NormalizedOutcome {
  id: string;
  description: string;
  schema: JsonSchema;
}

export interface NormalizedInteraction {
  semanticInteractionId: string;
  operationId: string;
  inputSchema: JsonSchema;
  outputs: NormalizedOutcome[];
  errors: NormalizedOutcome[];
  nativeAnchors: string[];
}

export interface NormalizedInterfaceIndex {
  interfaceId: string;
  interactions: NormalizedInteraction[];
}

export interface InterfaceContractBundle extends RevisionMetadata {
  interfaceId: string;
  boundaryRevisionId: string;
  profileRevisionId: string;
  adapter: AdapterProgram;
  formalContract: FormalInterfaceContract;
  normalizedIndex: NormalizedInterfaceIndex;
}

export interface ProtocolTransition {
  id: string;
  fromState: string;
  interactionId: string;
  outcomeId: string;
  toState: string;
  description: string;
}

export interface SubjectProtocolContract {
  initialState: string;
  states: string[];
  transitions: ProtocolTransition[];
  orderingRules: string[];
}

export type SubjectFactoryKind =
  | "constructor"
  | "factory"
  | "endpoint"
  | "command"
  | "fixture";

export interface InteractionHarnessBinding {
  interactionId: string;
  invoke: string;
  observe: string;
}

export interface HarnessBindingContract {
  moduleSpecifier: string;
  subjectType: string;
  factoryKind: SubjectFactoryKind;
  freshInstance: string;
  resetStrategy: string;
  fixtureSchema: JsonSchema;
  interactions: InteractionHarnessBinding[];
}

export interface SubjectContractBundle extends RevisionMetadata {
  subjectId: string;
  boundaryRevisionId: string;
  profileRevisionId: string;
  interfaceContractRevisionIds: string[];
  protocol: SubjectProtocolContract;
  harness: HarnessBindingContract;
}

export type MatcherKind =
  | "exact"
  | "schema"
  | "presence"
  | "subset"
  | "range"
  | "regex"
  | "unordered_list";

export interface ExactMatcher {
  kind: "exact";
  value: JsonValue;
}

export interface SchemaMatcher {
  kind: "schema";
}

export interface PresenceMatcher {
  kind: "presence";
  pointer: string;
  present: boolean;
}

export interface SubsetMatcher {
  kind: "subset";
  value: JsonValue;
}

export interface RangeMatcher {
  kind: "range";
  pointer: string;
  minimum?: number;
  maximum?: number;
}

export interface RegexMatcher {
  kind: "regex";
  pointer: string;
  pattern: string;
}

export interface UnorderedListMatcher {
  kind: "unordered_list";
  pointer: string;
  items: JsonValue[];
}

export type PortableMatcher =
  | ExactMatcher
  | SchemaMatcher
  | PresenceMatcher
  | SubsetMatcher
  | RangeMatcher
  | RegexMatcher
  | UnorderedListMatcher;

export interface ValueCapture {
  name: string;
  pointer: string;
}

export type TraceEventKind =
  | "input"
  | "output"
  | "error"
  | "event"
  | "silence";

export interface BehavioralTraceEvent {
  id: string;
  kind: TraceEventKind;
  correlationAlias?: string;
  interfaceId: string;
  interactionId: string;
  outcomeId?: string;
  payload?: JsonValue;
  matcher?: PortableMatcher;
  captures: ValueCapture[];
  withinMs?: number;
}

export interface BehavioralScenarioBinding {
  kind: "behavioral";
  subjectId: string;
  interfaceIds: string[];
  boundaryRevisionId: string;
  interfaceContractRevisionIds: string[];
  subjectContractRevisionId: string;
}

export interface VerificationScenarioBinding {
  kind: "verification";
  verificationObligationId: string;
  boundaryRevisionId: string;
  verificationContractRevisionId: string;
}

export type TestScenarioBinding =
  | BehavioralScenarioBinding
  | VerificationScenarioBinding;

export interface BehavioralCaseDefinition {
  kind: "behavioral";
  scenarioRevisionId: string;
  subjectId: string;
  initialFixture: JsonValue;
  trace: BehavioralTraceEvent[];
  boundaryRevisionId: string;
  interfaceContractRevisionIds: string[];
  subjectContractRevisionId: string;
}

export interface VerificationPlan {
  kind: "verification";
  scenarioRevisionId: string;
  setup: string[];
  stimulus: string[];
  evidence: string[];
  passMatchers: PortableMatcher[];
  verificationContractRevisionId: string;
}

export type TestCaseDefinition =
  | BehavioralCaseDefinition
  | VerificationPlan;

export interface VerificationContract extends RevisionMetadata {
  verificationObligationId: string;
  boundaryRevisionId: string;
  profileRevisionId: string;
  environment: string[];
  stimulus: string[];
  evidenceSchema: JsonSchema;
  passMatchers: PortableMatcher[];
}

export interface ContractSuite {
  id: string;
  revisionId: string;
  revision: number;
  createdAt: string;
  boundaryRevisionId: string;
  profileRevisionId: string;
  interfaceContracts: InterfaceContractBundle[];
  subjectContracts: SubjectContractBundle[];
  verificationContracts: VerificationContract[];
}

export interface ProjectBuildConfiguration {
  packageManager: string;
  testFramework: string;
  buildCommand: string;
  testCommand: string;
  settings: { [key: string]: JsonValue };
}

export interface ContractPlacement {
  interfaceContractRevisionId: string;
  documentPath: string;
  scaffoldPath: string;
  sha256: string;
}

export interface TestTarget {
  scenarioId: string;
  path: string;
}

export interface SubjectScaffoldBinding {
  subjectId: string;
  subjectContractRevisionId: string;
  moduleName: string;
  sourcePath: string;
}

export interface ScaffoldManifest {
  language: string;
  moduleNames: string[];
  sourceRoots: string[];
  testRoots: string[];
  contractPlacements: ContractPlacement[];
  testTargets: TestTarget[];
  subjectBindings: SubjectScaffoldBinding[];
}

export interface ScaffoldFile {
  path: string;
  content: string;
}

export interface ProjectSetup extends RevisionMetadata {
  boundaryRevisionId: string;
  profileRevisionId: string;
  contractSuiteRevisionId: string;
  testDesignFingerprint: string;
  configuration: ProjectBuildConfiguration;
  manifest: ScaffoldManifest;
  files: ScaffoldFile[];
}

export interface RevisionBindingMetadata {
  adapterIds: string[];
  interfaceContractRevisionIds: string[];
  subjectContractRevisionIds: string[];
}

export type BoundaryDesignProposal = Omit<
  BoundaryDesign,
  keyof RevisionMetadata | "requirementsRevisionId" | "acceptanceCriteriaRevisionId"
>;

export type ImplementationProfileProposal = Omit<
  ImplementationProfile,
  keyof RevisionMetadata | "boundaryRevisionId"
>;

export interface NativeContractDocumentProposal
  extends Omit<NativeContractDocument, "sha256"> {
  sha256?: string;
}

export interface InterfaceContractBundleProposal {
  interfaceId: string;
  adapter: AdapterProgram;
  formalContract: Omit<FormalInterfaceContract, "documents"> & {
    documents: NativeContractDocumentProposal[];
  };
  normalizedIndex: NormalizedInterfaceIndex;
}

export interface SubjectContractBundleProposal {
  subjectId: string;
  interfaceIds: string[];
  protocol: SubjectProtocolContract;
  harness: HarnessBindingContract;
}

export interface VerificationContractProposal {
  verificationObligationId: string;
  environment: string[];
  stimulus: string[];
  evidenceSchema: JsonSchema;
  passMatchers: PortableMatcher[];
}

export interface ContractSuiteProposal {
  interfaceContracts: InterfaceContractBundleProposal[];
  subjectContracts: SubjectContractBundleProposal[];
  verificationContracts: VerificationContractProposal[];
}

export interface TestScenarioProposalItem {
  key: string;
  id?: string;
  title: string;
  description: string;
  priority: "p0" | "p1" | "p2";
  acceptanceCriteriaIds: string[];
  binding: TestScenarioBinding;
  dependencies: string[];
}

export interface TestScenarioListProposal {
  items: TestScenarioProposalItem[];
}

export interface TestCaseProposalItem {
  key: string;
  id?: string;
  title: string;
  description: string;
  priority: "p0" | "p1" | "p2";
  acceptanceCriteriaIds: string[];
  definition: TestCaseDefinition;
  dependencies: string[];
}

export interface TestCaseListProposal {
  scenarioId: string;
  items: TestCaseProposalItem[];
}

export type ProjectSetupProposal = Omit<ProjectSetup, keyof RevisionMetadata>;
