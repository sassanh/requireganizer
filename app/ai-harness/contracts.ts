import {
  Framework,
  Priority,
  ProgrammingLanguage,
  StructuralFragment,
} from "store/constants";

export interface ProductOverviewProposal {
  name: string;
  purpose: string;
  primaryFeatures: string[];
  targetUsers: string[];
  framework: Framework;
  programmingLanguage: ProgrammingLanguage;
}

export interface ArtifactReferenceProposal {
  id: string;
  type: StructuralFragment;
}

export interface ArtifactProposalItem {
  key: string;
  id?: string;
  content?: string;
  title?: string;
  steps?: string;
  expectedResult?: string;
  priority: Priority;
  references: ArtifactReferenceProposal[];
  dependencies: string[];
}

export interface ArtifactListProposal {
  entityType: StructuralFragment;
  parentId?: string;
  items: ArtifactProposalItem[];
}

export interface FragmentRevisionProposal {
  entityType: StructuralFragment;
  id: string;
  patch: {
    content?: string;
    title?: string;
    steps?: string;
    expectedResult?: string;
    priority?: Priority;
  };
}

export interface ProjectConfigurationProposal {
  packageManager: string;
  testFramework: string;
  buildCommand: string;
  testCommand: string;
  settings: Record<string, unknown>;
}

export interface ScaffoldFileProposal {
  path: string;
  content: string;
}

export interface ScaffoldProposal {
  files: ScaffoldFileProposal[];
}

export interface TestCodeProjectContext {
  name: string;
  purpose: string;
  framework: Framework;
  programmingLanguage: ProgrammingLanguage;
}

export interface TestCodeScenarioContext {
  id: string;
  code: string;
  content: string;
}

export interface TestCodeCaseContext {
  id: string;
  code: string;
  title: string;
  steps: string;
  expectedResult: string;
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
  comment?: string;
}

export interface TestCodeProposal {
  path: string;
  code: string;
}
