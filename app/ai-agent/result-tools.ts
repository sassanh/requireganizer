import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";

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
  buildOverviewFieldRevisionTool,
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
  ContractSuite,
  ProjectSetup,
} from "contract-domain";
import { UserFacingError } from "lib/errors";
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
import {
  OVERVIEW_NAME_QUALITY_ID,
  OVERVIEW_PURPOSE_QUALITY_ID,
  WorkflowStage,
  StructuralFragment,
} from "store/constants";
import { uncoveredIds } from "store/integrity";
import type { TestCase, TestScenario } from "store/models";
import type { FlatStore } from "store/store";
import { generateTestAnnotation } from "utilities/testParser";

import type { AiCommand, CommandStage } from "./command";

type ToolArgs = Record<string, unknown>;

function agentTool(
  definition: {
    name: string;
    description?: string;
    parameters?: unknown;
  },
  execute: (args: ToolArgs) => Promise<string>,
): AgentTool {
  return {
    name: definition.name,
    label: definition.name,
    description: definition.description ?? definition.name,
    parameters: (definition.parameters ?? Type.Object({})) as never,
    execute: async (_toolCallId, params) => {
      const text = await execute(params as ToolArgs);
      return { content: [{ type: "text", text }], details: {} };
    },
  };
}

function assertRevisionIsolation(
  proposal: Parameters<typeof validateContractSuiteProposal>[0],
  current: ContractSuite,
  design: BoundaryDesign,
  target: { kind: "interface" | "subject" | "verification"; id: string },
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

export function buildCommunicateTool(store?: FlatStore): AgentTool {
  return {
    name: COMMUNICATE_TOOL.name,
    label: "Ask the user",
    description: COMMUNICATE_TOOL.description ?? COMMUNICATE_TOOL.name,
    parameters: Type.Object({
      message: Type.String({
        description:
          "A concise explanation of what is missing and what the user must clarify.",
        minLength: 1,
      }),
    }),
    execute: async (_toolCallId, params) => {
      const message = (params as ToolArgs).message;
      if (typeof message !== "string" || message.trim().length === 0) {
        throw new Error("A concise question is required.");
      }
      store?.communicate({ description: message });
      return {
        content: [{ type: "text", text: "Question delivered to the user." }],
        details: {},
      };
    },
  };
}

let pendingStageUnlock: AgentTool[] | null = null;

/** Consumed by the agent's prepareNextTurn hook to merge unlocked tools. */
export function consumePendingStageUnlock(): AgentTool[] | null {
  const unlocked = pendingStageUnlock;
  pendingStageUnlock = null;
  return unlocked;
}

const ACTIVATABLE_STAGES: CommandStage[] = [
  "implementation-profile",
  ...Object.values(WorkflowStage).filter((step) => step !== WorkflowStage.Code),
];

/**
 * Free-form conversation turns cannot know which stage the model will work
 * on, so this tool lets the model unlock a stage's submission channel
 * mid-turn. Prerequisites are validated by the same construction path the
 * stage command uses; the unlocked tools reach the next provider request
 * through the agent's prepareNextTurn hook.
 */
export function buildStageActivationTool(store: FlatStore): AgentTool {
  return agentTool(
    {
      name: "activate_stage_result_tool",
      description:
        "Unlock the result-submission tool for one workflow stage so you can submit that stage's artifacts in this conversation. Validates the stage prerequisites. Use it when you intend to submit artifacts and the stage's submit tool is not in your toolset.",
      parameters: Type.Object({
        stage: Type.Union(
          ACTIVATABLE_STAGES.map((stage) => Type.Literal(stage)),
          { description: "The workflow stage to unlock the submission tool for." },
        ),
      }),
    },
    async (params) => {
      const { stage } = params as { stage: CommandStage };
      let tools: AgentTool[];
      try {
        tools = buildResultTools(store, { kind: "generate", stage });
      } catch (error) {
        return `Cannot unlock ${stage}: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
      pendingStageUnlock = tools;
      return `Unlocked: ${tools
        .map((tool) => tool.name)
        .join(", ")}. They are available from your next step — call the stage's submit tool now with the complete proposal.`;
    },
  );
}

const ALL_STAGE_COMMANDS: AiCommand[] = [
  { kind: "generate", stage: "implementation-profile" },
  ...Object.values(WorkflowStage)
    .filter((step) => step !== WorkflowStage.Code)
    .map((step) => ({ kind: "generate", stage: step }) as AiCommand),
];

/**
 * Every stage submission channel whose prerequisites currently hold,
 * deduplicated by name (the communicate tool appears in each stage set).
 * Stages whose prerequisites are missing stay absent until the workflow
 * unlocks them — construction is the gate.
 */
export function buildAllStageResultTools(store: FlatStore): AgentTool[] {
  const merged: AgentTool[] = [];
  const seen = new Set<string>();
  for (const command of ALL_STAGE_COMMANDS) {
    let tools: AgentTool[];
    try {
      tools = buildResultTools(store, command);
    } catch {
      continue; // this stage's prerequisites are not met yet
    }
    for (const tool of tools) {
      if (seen.has(tool.name)) continue;
      seen.add(tool.name);
      merged.push(tool);
    }
  }
  return merged;
}

/**
 * Build the result tools for one conversation turn. The tools embed the live
 * store state (valid IDs, revisions) at call time and apply validated
 * proposals directly to the store.
 */
export function buildResultTools(store: FlatStore, command: AiCommand): AgentTool[] {
  const communicate = buildCommunicateTool(store);

  const stageTools: AgentTool[] = [];

  if (command.kind === "generate" || command.kind === "revise") {
    if (command.kind === "generate") {
      const generateStage = command.stage === "implementation-profile"
        ? WorkflowStage.InterfaceContracts
        : command.stage;
      const reason = store.cannotGenerateReason(generateStage);
      if (reason != null) throw new UserFacingError(reason);
      if (
        command.stage === WorkflowStage.InterfaceContracts &&
        store.implementationProfile?.status !== "approved"
      ) {
        throw new UserFacingError("Approve the implementation profile first.");
      }
    }
    const applyOptions = { markGenerated: true };
    const reviseTarget = command.kind === "revise"
      ? command.target ?? undefined
      : undefined;

    if (command.stage === "implementation-profile") {
      stageTools.push(agentTool(buildImplementationProfileTool(), async (args) => {
        const proposal = parseImplementationProfileProposal(args);
        applyImplementationProfileProposal(store, proposal);
        return "Implementation profile applied.";
      }));
    }

    switch (command.stage) {
      case WorkflowStage.ProductOverview: {
        const state = JSON.parse(store.json(WorkflowStage.ProductOverview)) as Record<string, unknown>;
        stageTools.push(agentTool(buildProductOverviewTool(state), async (args) => {
          const proposal = parseProductOverviewProposal(args, state);
          applyProductOverviewProposal(store, proposal, applyOptions);
          return "Product overview applied.";
        }));
        break;
      }
      case WorkflowStage.UserStories:
      case WorkflowStage.Requirements:
      case WorkflowStage.AcceptanceCriteria: {
        const fragmentType = {
          [WorkflowStage.UserStories]: StructuralFragment.UserStory,
          [WorkflowStage.Requirements]: StructuralFragment.Requirement,
          [WorkflowStage.AcceptanceCriteria]: StructuralFragment.AcceptanceCriteria,
        }[command.stage as WorkflowStage.UserStories | WorkflowStage.Requirements | WorkflowStage.AcceptanceCriteria];
        if (fragmentType == null) {
          throw new Error(`No artifact stage for ${command.stage}.`);
        }
        const definition = getArtifactStageDefinition(fragmentType);
        const state = JSON.parse(store.json(definition.step)) as Record<string, unknown>;
        stageTools.push(agentTool(
          buildArtifactListTool({ definition, state }),
          async (args) => {
            const proposal = parseArtifactListProposal(args, {
              expectedEntityType: fragmentType,
              state,
            });
            applyArtifactListProposal(store, proposal, applyOptions);
            return `${definition.entityType} list applied.`;
          },
        ));
        break;
      }
      case WorkflowStage.BoundaryDesign: {
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
            store.eventTarget.emit("stepUpdate", WorkflowStage.BoundaryDesign);
            return "Boundary design applied.";
          },
        ));
        break;
      }
      case WorkflowStage.InterfaceContracts: {
        const design = store.boundaryDesign;
        const profile = store.implementationProfile;
        if (design == null || profile == null) {
          throw new Error("An approved boundary design and implementation profile are required.");
        }
        validateImplementationProfile(profile, design.revisionId);
        const currentSuite = reviseTarget != null
          ? store.contractSuite
          : null;

        if (currentSuite != null && reviseTarget == null) {
          throw new Error("A formal-contract revision requires one exact target.");
        }        if (currentSuite != null) {
          validateContractSuite(currentSuite, design, profile.revisionId);
        }
        stageTools.push(agentTool(buildContractSuiteTool(design), async (args) => {
          const proposal = parseContractSuiteProposal(args);
          validateContractSuiteProposal(proposal, design, profile.revisionId);
          if (currentSuite != null && reviseTarget != null) {
            assertRevisionIsolation(proposal, currentSuite, design, reviseTarget);
          }
          applyContractSuiteProposal(store, proposal);          return "Formal contracts applied.";
        }));
        break;
      }
      case WorkflowStage.TestScenarios: {
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
            const missingCriteria = uncoveredIds(
              acceptanceCriteriaIds,
              proposal.items.flatMap((item) => item.acceptanceCriteriaIds),
            );
            if (missingCriteria.length > 0) {
              throw new Error(
                `Test scenario proposal does not cover acceptance criterion ${missingCriteria[0]}.`,
              );
            }
            applyTestScenarioProposal(store, proposal);
            store.eventTarget.emit("stepUpdate", WorkflowStage.TestScenarios);
            return "Test scenarios applied.";
          },
        ));
        break;
      }
      case WorkflowStage.TestCases: {
        const design = store.boundaryDesign;
        const suite = store.contractSuite;
        if (design == null || suite == null) {
          throw new Error("An approved boundary design and contract suite are required.");
        }
        const requestedScenarioId = command.kind === "generate" ? command.scenarioId : undefined;
        const scenario: TestScenario | undefined = requestedScenarioId != null
          ? store.testScenarios.find(({ id }) => id === requestedScenarioId)
          : store.testScenarios.find(({ binding }) => binding != null);
        if (scenario == null || scenario.binding == null) {
          throw new Error("No test scenario with a contract binding is available.");
        }
        if (command.kind === "generate" && scenario.approval !== "approved") {
          throw new Error("Approve this scenario before generating its cases.");
        }
        const snapshot = scenarioSnapshot(scenario);
        const scenarioBinding = snapshot.binding;
        if (scenarioBinding == null) {
          throw new Error(`Scenario ${scenario.id} has no contract binding.`);
        }
        const existingIds = scenario.testCases.map((testCase: TestCase) => testCase.id);
        stageTools.push(agentTool(
          buildTestCaseListTool({
            design,
            suite,
            binding: scenarioBinding,
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
                scenarioBinding,
                design,
                suite,
                snapshot.revisionId,
              );
            }
            const missingCriteria = uncoveredIds(
              snapshot.acceptanceCriteriaIds,
              proposal.items.flatMap((item) => item.acceptanceCriteriaIds),
            );
            if (missingCriteria.length > 0) {
              throw new Error(
                `Test case proposal does not cover acceptance criterion ${missingCriteria[0]}.`,
              );
            }
            applyTestCaseProposal(store, proposal);
            store.eventTarget.emit("stepUpdate", WorkflowStage.TestCases);
            return "Test cases applied.";
          },
        ));
        break;
      }
      case WorkflowStage.ProjectSetup: {
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
            store.eventTarget.emit("stepUpdate", WorkflowStage.ProjectSetup);
            return "Project setup applied.";
          },
        ));
        break;
      }
      default:
        break;
    }
  }

  if (command.kind === "comment") {
    if (
      command.id === OVERVIEW_NAME_QUALITY_ID ||
      command.id === OVERVIEW_PURPOSE_QUALITY_ID
    ) {
      const field = command.id === OVERVIEW_NAME_QUALITY_ID ? "name" : "purpose";
      stageTools.push(agentTool(
        buildOverviewFieldRevisionTool(field),
        async (args) => {
          const content = args.content;
          if (typeof content !== "string" || content.trim().length === 0) {
            throw new Error("Replacement content is required.");
          }
          if (field === "name") store.setName({ name: content });
          else store.setPurpose({ purpose: content });
          return "Overview field applied.";
        },
      ));
    } else if (command.fragment != null) {
      stageTools.push(agentTool(
        buildFragmentRevisionTool(command.fragment),
        async (args) => {
          const patch = args.patch;
          const proposal = parseFragmentRevisionProposal(
            { patch },
            { expectedEntityType: command.fragment!, expectedId: command.id },
          );
          applyFragmentRevisionProposal(store, proposal);
          return "Fragment revision applied.";
        },
      ));
    }
  }

  if (command.kind === "test-code") {
    stageTools.push(agentTool(buildTestCodeTool(), async (args) => {
      const code = args.code;
      if (typeof code !== "string" || code.trim().length === 0) {
        throw new Error("The complete test file content is required.");
      }
      const testScenario: TestScenario | undefined = store.testScenarios.find(
        ({ id }) => id === command.scenarioId,
      );
      const testCase: TestCase | undefined = testScenario?.testCases.find(
        ({ id }) => id === command.testCaseId,
      );
      if (testScenario == null || testCase == null || testScenario.binding == null) {
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
      if (store.isProjectSetupOutdated) {
        throw new Error("Project Setup is stale; refresh it before generating tests.");
      }
      if (testCase.approval !== "approved") {
        throw new Error("Approve this test case before generating the automated test.");
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
      const scenarioAnnotation = generateTestAnnotation(language, "", validatedRequest.scenario.id, "scenario");
      const codeAndTitle = `${validatedRequest.testCase.code} - ${validatedRequest.testCase.title}`;
      const beginAnnotation = generateTestAnnotation(language, codeAndTitle, validatedRequest.testCase.id, "beginning");
      const endAnnotation = generateTestAnnotation(language, codeAndTitle, validatedRequest.testCase.id, "end");
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
      store.eventTarget.emit("stepUpdate", WorkflowStage.AutomatedTests);
      return `Test code applied to ${targetPath}.`;
    }));
  }

  return [...stageTools, communicate];
}
