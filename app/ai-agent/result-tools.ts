import type { AgentTool } from "@earendil-works/pi-agent-core";

import {
  assertValidGeneratedTestCode,
  collectProtectedTestBlocks,
} from "ai-harness/test-code";
import {
  buildArtifactListTool,
  buildBoundaryDesignTool,
  buildContractSuiteTool,
  buildFragmentRevisionTool,
  buildImplementationProfileTool,
  buildProductOverviewTool,
  buildProjectSetupTool,
  buildTestCaseListTool,
  buildTestCodeTool,
  buildTestScenarioListTool,
  COMMUNICATE_TOOL,
} from "ai-harness/tools";
import {
  parseArtifactListProposal,
  parseFragmentRevisionProposal,
  parseProductOverviewProposal,
  parseTestCodeProposal,
  parseTestCodeRequest,
} from "ai-harness/validation";
import { getArtifactStageDefinition } from "ai-harness/workflow";
import {
  fingerprint,
  parseBoundaryDesignProposal,
  parseContractSuiteProposal,
  parseImplementationProfileProposal,
  parseProjectSetupProposal,
  parseTestCaseListProposal,
  parseTestScenarioListProposal,
  validateBoundaryDesign,
  validateContractSuite,
  validateContractSuiteProposal,
  validateImplementationProfile,
  validateProjectSetup,
  validateScenarioAcceptanceCriteria,
  validateScenarioBinding,
  validateTestCaseDefinition,
} from "contract-domain";
import type {
  BoundaryDesign,
  ContractSuiteProposal,
  ProjectSetup,
} from "contract-domain";
import { STEP_BY_STRUCTURAL_FRAGMENT } from "store";
import {
  applyArtifactListProposal,
  applyBoundaryDesignProposal,
  applyContractSuiteProposal,
  applyFragmentRevisionProposal,
  applyImplementationProfileProposal,
  applyProductOverviewProposal,
  applyProjectSetupProposal,
  applyTestCaseProposal,
  applyTestCodeProposal,
  applyTestScenarioProposal,
} from "store/actions/ai-actions/utilities";
import { Step, StructuralFragment } from "store/constants";
import type { TestCase, TestScenario } from "store/models";
import type { FlatStore } from "store/store";
import { generateTestAnnotation } from "utilities/testParser";

import type { AiCommand } from "./command";


type RevisionTarget = NonNullable<
  Extract<AiCommand, { kind: "revise" }>["target"]
>;

function agentTool(
  definition: ReturnType<typeof buildProductOverviewTool>,
  execute: (args: Record<string, unknown>) => Promise<string>,
): AgentTool {
  return {
    name: definition.name,
    label: definition.name,
    description: definition.description ?? "",
    parameters: definition.parameters! as AgentTool["parameters"],
    execute: async (_toolCallId, params) => {
      const text = await execute(params as Record<string, unknown>);
      return { content: [{ type: "text", text }], details: {} };
    },
  };
}

function assertRevisionIsolation(
  proposal: ContractSuiteProposal,
  current: NonNullable<FlatStore["contractSuite"]>,
  design: BoundaryDesign,
  target: RevisionTarget,
): void {
  const targetSemanticId =
    target.kind === "interface"
      ? current.interfaceContracts.find(({ id }) => id === target.id)?.interfaceId
      : target.kind === "subject"
        ? current.subjectContracts.find(({ id }) => id === target.id)?.subjectId
        : current.verificationContracts.find(({ id }) => id === target.id)
            ?.verificationObligationId;
  if (targetSemanticId == null) {
    throw new Error(`The selected ${target.kind} contract no longer exists.`);
  }

  for (const candidate of proposal.interfaceContracts) {
    if (target.kind === "interface" && candidate.interfaceId === targetSemanticId) {
      continue;
    }
    const existing = current.interfaceContracts.find(
      ({ interfaceId }) => interfaceId === candidate.interfaceId,
    );
    if (
      existing == null ||
      fingerprint({
        interfaceId: candidate.interfaceId,
        adapter: candidate.adapter,
        formalContract: {
          ...candidate.formalContract,
          documents: candidate.formalContract.documents.map(
            ({ sha256: _sha256, ...document }) => document,
          ),
        },
        normalizedIndex: candidate.normalizedIndex,
      }) !==
        fingerprint({
          interfaceId: existing.interfaceId,
          adapter: existing.adapter,
          formalContract: {
            ...existing.formalContract,
            documents: existing.formalContract.documents.map(
              ({ sha256: _sha256, ...document }) => document,
            ),
          },
          normalizedIndex: existing.normalizedIndex,
        })
    ) {
      throw new Error(
        `The revision changed non-target interface contract ${candidate.interfaceId}.`,
      );
    }
  }

  for (const candidate of proposal.subjectContracts) {
    if (target.kind === "subject" && candidate.subjectId === targetSemanticId) {
      continue;
    }
    const existing = current.subjectContracts.find(
      ({ subjectId }) => subjectId === candidate.subjectId,
    );
    const existingInterfaceIds = design.interfaces
      .filter(({ subjectId }) => subjectId === candidate.subjectId)
      .map(({ id }) => id);
    if (
      existing == null ||
      fingerprint(candidate) !==
        fingerprint({
          subjectId: existing.subjectId,
          interfaceIds: existingInterfaceIds,
          protocol: existing.protocol,
          harness: existing.harness,
        })
    ) {
      throw new Error(
        `The revision changed non-target subject contract ${candidate.subjectId}.`,
      );
    }
  }

  for (const candidate of proposal.verificationContracts) {
    if (
      target.kind === "verification" &&
      candidate.verificationObligationId === targetSemanticId
    ) {
      continue;
    }
    const existing = current.verificationContracts.find(
      ({ verificationObligationId }) =>
        verificationObligationId === candidate.verificationObligationId,
    );
    if (
      existing == null ||
      fingerprint(candidate) !==
        fingerprint({
          verificationObligationId: existing.verificationObligationId,
          environment: existing.environment,
          stimulus: existing.stimulus,
          evidenceSchema: existing.evidenceSchema,
          passMatchers: existing.passMatchers,
        })
    ) {
      throw new Error(
        `The revision changed non-target verification contract ${candidate.verificationObligationId}.`,
      );
    }
  }
}

function scenarioSnapshot(scenario: TestScenario) {
  return {
    id: scenario.id,
    revisionId: scenario.revisionId,
    title: scenario.content,
    description: scenario.description,
    acceptanceCriteriaIds: scenario.references
      .filter((reference) => reference.type === "acceptance_criteria")
      .map(({ id }) => id),
    binding: scenario.binding,
  };
}

/**
 * Build the result tools for one conversation turn. The tools embed the live
 * store state (valid IDs, revisions) at call time and apply validated
 * proposals directly to the store.
 */
export function buildResultTools(store: FlatStore, command: AiCommand): AgentTool[] {
  const communicate: AgentTool = {
    name: COMMUNICATE_TOOL.name,
    label: "Ask the user",
    description: COMMUNICATE_TOOL.description ?? "",
    parameters: COMMUNICATE_TOOL.parameters! as AgentTool["parameters"],
    execute: async (_toolCallId, params) => {
      const message = (params as { message?: unknown }).message;
      if (typeof message !== "string" || message.trim().length === 0) {
        throw new Error("A concise question is required.");
      }
      store.communicate({ description: message });
      return {
        content: [{ type: "text", text: "Question delivered to the user." }],
        details: {},
      };
    },
  };

  const stageTools: AgentTool[] = [];

  if (command.kind === "generate" || command.kind === "revise") {
    const stage = command.stage;

    if (stage === Step.ProductOverview) {
      stageTools.push(agentTool(buildProductOverviewTool(), async (args) => {
        const proposal = parseProductOverviewProposal(args);
        applyProductOverviewProposal(store, proposal);
        return "Product overview applied.";
      }));
    } else if (
      stage === Step.UserStories ||
      stage === Step.Requirements ||
      stage === Step.AcceptanceCriteria
    ) {
      const fragmentByStage = {
        [Step.UserStories]: StructuralFragment.UserStory,
        [Step.Requirements]: StructuralFragment.Requirement,
        [Step.AcceptanceCriteria]: StructuralFragment.AcceptanceCriteria,
      } as const;
      const fragmentType = fragmentByStage[stage as keyof typeof fragmentByStage];
      const definition = getArtifactStageDefinition(fragmentType);
      const state = JSON.parse(store.json(definition.step)) as Record<string, unknown>;
      stageTools.push(agentTool(
        buildArtifactListTool({ definition, state }),
        async (args) => {
          const proposal = parseArtifactListProposal(args, {
            expectedEntityType: fragmentType,
            state,
          });
          applyArtifactListProposal(store, proposal);
          return `${definition.entityType} list applied.`;
        },
      ));
    } else if (stage === Step.BoundaryDesign) {
      const requirementIds = store.requirements.map(({ id }) => id);
      const acceptanceCriteriaIds = store.acceptanceCriteria.map(({ id }) => id);
      stageTools.push(agentTool(
        buildBoundaryDesignTool({ requirementIds, acceptanceCriteriaIds }),
        async (args) => {
          const proposal = parseBoundaryDesignProposal(args);
          validateBoundaryDesign(proposal, {
            requirementIds: new Set(requirementIds),
            acceptanceCriteriaIds: new Set(acceptanceCriteriaIds),
          });
          applyBoundaryDesignProposal(store, proposal);
          return "Boundary design applied.";
        },
      ));
    } else if (stage === "implementation-profile") {
      stageTools.push(agentTool(buildImplementationProfileTool(), async (args) => {
        const proposal = parseImplementationProfileProposal(args);
        applyImplementationProfileProposal(store, proposal);
        return "Implementation profile applied.";
      }));
    } else if (stage === Step.InterfaceContracts) {
      const design = store.boundaryDesign;
      const profile = store.implementationProfile;
      if (design == null || profile == null) {
        throw new Error("An approved boundary design and implementation profile are required.");
      }
      validateImplementationProfile(profile, design.revisionId);
      const revising = command.kind === "revise";
      const target = revising ? command.target : undefined;
      const currentSuite = revising ? store.contractSuite : null;
      if (currentSuite != null && target == null) {
        throw new Error("A formal-contract revision requires one exact target.");
      }
      if (currentSuite != null) {
        validateContractSuite(currentSuite, design, profile.revisionId);
      }
      stageTools.push(agentTool(buildContractSuiteTool(design), async (args) => {
        const proposal = parseContractSuiteProposal(args);
        validateContractSuiteProposal(proposal, design, profile.revisionId);
        if (currentSuite != null && target != null) {
          assertRevisionIsolation(proposal, currentSuite, design, target);
        }
        applyContractSuiteProposal(store, proposal);
        return "Formal contracts applied.";
      }));
    } else if (stage === Step.TestScenarios) {
      const design = store.boundaryDesign;
      const suite = store.contractSuite;
      if (design == null || suite == null) {
        throw new Error("An approved boundary design and contract suite are required.");
      }
      const acceptanceCriteriaIds = store.acceptanceCriteria.map(({ id }) => id);
      const existingIds = store.testScenarios.map(({ id }) => id);
      stageTools.push(agentTool(
        buildTestScenarioListTool(design, suite, acceptanceCriteriaIds, existingIds),
        async (args) => {
          const proposal = parseTestScenarioListProposal(args, existingIds);
          const allowedCriteria = new Set(acceptanceCriteriaIds);
          for (const item of proposal.items) {
            validateScenarioBinding(item.binding, design, suite);
            validateScenarioAcceptanceCriteria(
              item.acceptanceCriteriaIds,
              item.binding,
              design,
            );
            for (const id of item.acceptanceCriteriaIds) {
              if (!allowedCriteria.has(id)) {
                throw new Error(`Scenario ${item.key} references unknown acceptance criterion ${id}.`);
              }
            }
          }
          for (const id of acceptanceCriteriaIds) {
            if (!proposal.items.some((item) => item.acceptanceCriteriaIds.includes(id))) {
              throw new Error(`Test scenario proposal does not cover acceptance criterion ${id}.`);
            }
          }
          applyTestScenarioProposal(store, proposal);
          return "Test scenarios applied.";
        },
      ));
    } else if (stage === Step.TestCases) {
      const design = store.boundaryDesign;
      const suite = store.contractSuite;
      if (design == null || suite == null) {
        throw new Error("An approved boundary design and contract suite are required.");
      }
      const scenario: TestScenario | undefined = command.scenarioId != null
        ? store.testScenarios.find(({ id }) => id === command.scenarioId)
        : store.testScenarios.find(({ binding }) => binding != null);
      const binding = scenario?.binding ?? null;
      if (scenario == null || binding == null) {
        throw new Error("No test scenario with a contract binding is available.");
      }
      const snapshot = { ...scenarioSnapshot(scenario), binding };
      const existingIds = scenario.testCases.map(({ id }) => id);
      stageTools.push(agentTool(
        buildTestCaseListTool({
          design,
          suite,
          binding: snapshot.binding,
          scenarioRevisionId: snapshot.revisionId,
          acceptanceCriteriaIds: snapshot.acceptanceCriteriaIds,
          existingIds,
        }),
        async (args) => {
          const proposal = parseTestCaseListProposal(args, snapshot.id, existingIds);
          const allowedCriteria = new Set(snapshot.acceptanceCriteriaIds);
          for (const item of proposal.items) {
            for (const id of item.acceptanceCriteriaIds) {
              if (!allowedCriteria.has(id)) {
                throw new Error(`Test case ${item.key} references acceptance criterion ${id} outside its scenario.`);
              }
            }
            validateTestCaseDefinition(
              item.definition,
              binding,
              design,
              suite,
              snapshot.revisionId,
            );
          }
          for (const id of snapshot.acceptanceCriteriaIds) {
            if (!proposal.items.some((item) => item.acceptanceCriteriaIds.includes(id))) {
              throw new Error(`Test case proposal does not cover acceptance criterion ${id}.`);
            }
          }
          applyTestCaseProposal(store, proposal);
          return "Test cases applied.";
        },
      ));
    } else if (stage === Step.ProjectSetup) {
      const design = store.boundaryDesign;
      const profile = store.implementationProfile;
      const suite = store.contractSuite;
      if (design == null || profile == null || suite == null) {
        throw new Error("Approved contracts and an implementation profile are required.");
      }
      const scenarioIds = store.testScenarios.map(({ id }) => id);
      const testDesignFingerprint = store.testDesignFingerprint;
      stageTools.push(agentTool(
        buildProjectSetupTool({ design, profile, suite, scenarioIds, testDesignFingerprint }),
        async (args) => {
          const proposal = parseProjectSetupProposal(args);
          const candidate: ProjectSetup = {
            id: "project-setup-proposal",
            revisionId: "project-setup-proposal-revision",
            revision: 1,
            status: "draft",
            createdAt: "1970-01-01T00:00:00.000Z",
            ...proposal,
          };
          validateProjectSetup(
            candidate,
            design,
            profile,
            suite,
            testDesignFingerprint,
            new Set(scenarioIds),
          );
          applyProjectSetupProposal(store, proposal);
          return "Project setup applied.";
        },
      ));
    }
  }

  if (command.kind === "comment") {
    stageTools.push(agentTool(
      buildFragmentRevisionTool(command.fragment),
      async (args) => {
        const proposal = parseFragmentRevisionProposal(
          args,
          { expectedEntityType: command.fragment, expectedId: command.id },
        );
        applyFragmentRevisionProposal(store, proposal);
        return "Fragment revision applied.";
      },
    ));
    void STEP_BY_STRUCTURAL_FRAGMENT;
  }

  if (command.kind === "test-code") {
    stageTools.push(agentTool(buildTestCodeTool(), async (args) => {
      const code = args.code;
      if (typeof code !== "string" || code.trim().length === 0) {
        throw new Error("The complete test file content is required.");
      }
      const testScenario = store.testScenarios.find(({ id }) => id === command.scenarioId);
      const testCase = (store.testScenarios
        .flatMap(({ testCases }) => testCases)
        .find(({ id }) => id === command.testCaseId)) as TestCase | undefined;
      if (testCase == null || testScenario == null || testScenario.binding == null) {
        throw new Error("The selected scenario or test case no longer exists.");
      }
      if (
        store.projectSetup == null ||
        store.implementationProfile == null ||
        store.contractSuite == null ||
        store.boundaryDesign == null
      ) {
        throw new Error("Project setup, contracts, and an implementation profile are required.");
      }
      if (testCase.definition == null) {
        throw new Error("The selected case has no approved structured contract binding.");
      }
      const target = store.projectSetup.manifest.testTargets.find(
        ({ scenarioId }) => scenarioId === testScenario.id,
      );
      if (target == null) {
        throw new Error("Project Setup has no test target for this scenario.");
      }
      const existing = store.scaffoldFiles.find(({ path }) => path === target.path) ?? null;
      const inputFingerprint = testCase.inputFingerprint;
      if (inputFingerprint == null) {
        throw new Error("The test case has no structured definition.");
      }
      const binding = testScenario.binding;
      const interfaceRevisionIds = binding.kind === "behavioral"
        ? binding.interfaceContractRevisionIds
        : [];
      const subjectRevisionIds = binding.kind === "behavioral"
        ? [binding.subjectContractRevisionId]
        : [];
      const interfaceContracts = store.contractSuite.interfaceContracts.filter(({ revisionId }) =>
        interfaceRevisionIds.includes(revisionId),
      );
      const subjectContracts = store.contractSuite.subjectContracts.filter(({ revisionId }) =>
        subjectRevisionIds.includes(revisionId),
      );
      const request = {
        project: {
          name: store.productOverview.name ?? "",
          purpose: store.productOverview.purpose ?? "",
          language: store.implementationProfile.language,
          framework: store.implementationProfile.framework,
        },
        projectConfig: store.projectSetup.configuration as unknown as Record<string, unknown>,
        contracts: {
          boundaryRevisionId: store.boundaryDesign.revisionId,
          interfaceContracts,
          subjectContracts,
          verificationContracts: binding.kind === "verification"
            ? store.contractSuite.verificationContracts.filter(
              ({ revisionId }) => revisionId === binding.verificationContractRevisionId,
            )
            : [],
        },
        scaffoldManifest: store.projectSetup.manifest as unknown as Record<string, unknown>,
        bindingMetadata: {
          adapterIds: interfaceContracts.map(({ adapter }) => `${adapter.id}@${adapter.version}`),
          interfaceContractRevisionIds: interfaceRevisionIds,
          subjectContractRevisionIds: subjectRevisionIds,
        },
        scenario: {
          id: testScenario.id,
          revisionId: testScenario.revisionId,
          code: testScenario.getCode(),
          content: `${testScenario.content}\n${testScenario.description}`,
          binding: testScenario.binding,
        },
        testCase: {
          id: testCase.id,
          revisionId: testCase.revisionId,
          code: testCase.getCode(),
          title: testCase.title,
          definition: testCase.definition,
          renderedSteps: testCase.steps,
          renderedExpectedResult: testCase.expectedResult,
        },
        targetPath: target.path,
        existingFile: existing == null ? null : { path: existing.path, content: existing.content },
        comment: command.comment,
      };
      const validatedRequest = parseTestCodeRequest(request);
      const targetPath = validatedRequest.targetPath;
      const language = validatedRequest.project.language;
      const scenarioAnnotation = generateTestAnnotation(
        language,
        "",
        validatedRequest.scenario.id,
        "scenario",
      );
      const codeAndTitle = `${validatedRequest.testCase.code} - ${validatedRequest.testCase.title}`;
      const beginAnnotation = generateTestAnnotation(
        language,
        codeAndTitle,
        validatedRequest.testCase.id,
        "beginning",
      );
      const endAnnotation = generateTestAnnotation(
        language,
        codeAndTitle,
        validatedRequest.testCase.id,
        "end",
      );
      const protectedBlocks = collectProtectedTestBlocks(
        validatedRequest.existingFile?.content,
        validatedRequest.testCase.id,
      );
      const proposal = parseTestCodeProposal({ code }, targetPath);
      assertValidGeneratedTestCode({
        code: proposal.code,
        scenarioAnnotation,
        beginAnnotation,
        endAnnotation,
        protectedBlocks,
      });
      applyTestCodeProposal(store, proposal, testCase.id, inputFingerprint);
      return `Test code applied to ${targetPath}.`;
    }));
  }

  return [...stageTools, communicate];
}
