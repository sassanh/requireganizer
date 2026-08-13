import type {
  RevisionBindingMetadata,
  TestCaseDefinition,
  TestScenarioBinding,
} from "contract-domain";
import {
  Priority,
  StructuralFragment,
} from "store/constants";

export interface ProductOverviewProposal {
  name: string;
  purpose: string;
  primaryFeatures: string[];
  targetUsers: string[];
}

export interface ArtifactReferenceProposal {
  id: string;
  type: StructuralFragment;
}

export interface ArtifactProposalItem {
  key: string;
  id?: string;
  content: string;
  priority: Priority;
  references: ArtifactReferenceProposal[];
  dependencies: string[];
}

export interface ArtifactListProposal {
  entityType: StructuralFragment;
  items: ArtifactProposalItem[];
}

export interface FragmentRevisionProposal {
  entityType: StructuralFragment;
  id: string;
  patch: {
    content?: string;
    priority?: Priority;
  };
}

export interface TestCodeProjectContext {
  name: string;
  purpose: string;
  language: string;
  framework: string;
}

export interface TestCodeScenarioContext {
  id: string;
  revisionId: string;
  code: string;
  content: string;
  binding: TestScenarioBinding;
}

export interface TestCodeCaseContext {
  id: string;
  revisionId: string;
  code: string;
  title: string;
  definition: TestCaseDefinition;
  renderedSteps: string;
  renderedExpectedResult: string;
}

export interface ExistingTestFileContext {
  path: string;
  content: string;
}

export interface TestCodeRequest {
  project: TestCodeProjectContext;
  projectConfig: Record<string, unknown>;
  scenario: TestCodeScenarioContext;
  testCase: TestCodeCaseContext;
  targetPath: string;
  existingFile: ExistingTestFileContext | null;
  contracts: Record<string, unknown>;
  scaffoldManifest: Record<string, unknown>;
  bindingMetadata: RevisionBindingMetadata;
  comment?: string;
}

export interface TestCodeProposal {
  path: string;
  code: string;
}
