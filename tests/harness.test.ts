import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseArtifactListProposal,
  parseFragmentRevisionProposal,
  parseProductOverviewProposal,
  parseTestCodeProposal,
  parseTestCodeRequest,
} from "../app/ai-harness/validation";
import {
  renderTestCaseExpectedResult,
  renderTestCaseSteps,
  type TestCaseDefinition,
} from "../app/contract-domain";
import {
  Priority,
  StructuralFragment,
} from "../app/store/constants";

const state = {
  description: "Build a reviewable requirements workspace.",
  productOverview: {
    name: "Requireganizer",
    purpose: "Create traceable engineering artifacts.",
    primaryFeatures: [
      { id: "feature-1", type: StructuralFragment.PrimaryFeature },
      { id: "feature-2", type: StructuralFragment.PrimaryFeature },
    ],
    targetUsers: [
      { id: "user-1", type: StructuralFragment.TargetUser },
    ],
  },
  userStories: [
    { id: "story-1", type: StructuralFragment.UserStory },
  ],
  requirements: [
    { id: "requirement-1", type: StructuralFragment.Requirement },
    { id: "requirement-2", type: StructuralFragment.Requirement },
  ],
  acceptanceCriteria: [
    { id: "criterion-1", type: StructuralFragment.AcceptanceCriteria },
  ],
};

describe("AI harness contracts", () => {
  it("keeps implementation choices out of product overview", () => {
    const proposal = {
      name: "Requireganizer",
      purpose: "Create traceable software plans.",
      primaryFeatures: ["Generate reviewable artifacts"],
      targetUsers: ["Software teams"],
    };

    assert.equal(parseProductOverviewProposal(proposal).name, "Requireganizer");
    assert.throws(
      () =>
        parseProductOverviewProposal({
          ...proposal,
          programmingLanguage: "TypeScript",
        }),
      /unsupported field/,
    );
  });

  it("derives stage identity on the server and requires traceable coverage", () => {
    const valid = {
      items: [
        {
          key: "traceable-story",
          content:
            "As a software lead, I want traceable artifacts, so that reviews stay auditable.",
          priority: Priority.P0,
          references: [
            { id: "feature-1", type: StructuralFragment.PrimaryFeature },
            { id: "feature-2", type: StructuralFragment.PrimaryFeature },
            { id: "user-1", type: StructuralFragment.TargetUser },
          ],
          dependencies: [],
        },
      ],
    };

    const parsed = parseArtifactListProposal(valid, {
      expectedEntityType: StructuralFragment.UserStory,
      state,
    });
    assert.equal(parsed.entityType, StructuralFragment.UserStory);
    assert.equal(parsed.items[0].key, "traceable-story");

    assert.throws(
      () =>
        parseArtifactListProposal(
          { ...valid, entityType: StructuralFragment.UserStory },
          {
            expectedEntityType: StructuralFragment.UserStory,
            state,
          },
        ),
      /unsupported field/,
    );
    assert.throws(
      () =>
        parseArtifactListProposal(
          {
            items: [
              {
                ...valid.items[0],
                references: [
                  { id: "feature-1", type: StructuralFragment.PrimaryFeature },
                ],
              },
            ],
          },
          {
            expectedEntityType: StructuralFragment.UserStory,
            state,
          },
        ),
      /does not cover/,
    );
  });

  it("rejects fabricated persisted IDs while allowing proposal-local keys", () => {
    assert.throws(
      () =>
        parseArtifactListProposal(
          {
            items: [
              {
                key: "ac-add-sum",
                id: "ac-add-sum",
                content: "The displayed result equals the sum.",
                priority: Priority.P0,
                references: [
                  { id: "requirement-1", type: StructuralFragment.Requirement },
                  { id: "requirement-2", type: StructuralFragment.Requirement },
                ],
                dependencies: [],
              },
            ],
          },
          {
            expectedEntityType: StructuralFragment.AcceptanceCriteria,
            state,
          },
        ),
      /id must identify an existing target item/,
    );

    const parsed = parseArtifactListProposal(
      {
        items: [
          {
            key: "ac-add-sum",
            content: "The displayed result equals the sum.",
            priority: Priority.P0,
            references: [
              { id: "requirement-1", type: StructuralFragment.Requirement },
              { id: "requirement-2", type: StructuralFragment.Requirement },
            ],
            dependencies: [],
          },
        ],
      },
      {
        expectedEntityType: StructuralFragment.AcceptanceCriteria,
        state,
      },
    );
    assert.equal(parsed.items[0].key, "ac-add-sum");
    assert.equal(parsed.items[0].id, undefined);
  });

  it("rejects dependency cycles expressed through proposal-local keys", () => {
    assert.throws(
      () =>
        parseArtifactListProposal(
          {
            items: [
              {
                key: "preserve-traceability",
                id: "requirement-1",
                content: "The system must preserve traceability.",
                priority: Priority.P0,
                references: [
                  { id: "story-1", type: StructuralFragment.UserStory },
                ],
                dependencies: ["expose-traceability"],
              },
              {
                key: "expose-traceability",
                id: "requirement-2",
                content: "The system must expose traceability.",
                priority: Priority.P1,
                references: [
                  { id: "story-1", type: StructuralFragment.UserStory },
                ],
                dependencies: ["preserve-traceability"],
              },
            ],
          },
          {
            expectedEntityType: StructuralFragment.Requirement,
            state,
          },
        ),
      /must not contain cycles/,
    );
  });

  it("keeps revision identity server-controlled", () => {
    assert.deepEqual(
      parseFragmentRevisionProposal(
        { patch: { content: "The system must expose an audit trail." } },
        {
          expectedEntityType: StructuralFragment.Requirement,
          expectedId: "requirement-1",
        },
      ),
      {
        entityType: StructuralFragment.Requirement,
        id: "requirement-1",
        patch: { content: "The system must expose an audit trail." },
      },
    );
    assert.throws(
      () =>
        parseFragmentRevisionProposal(
          {
            id: "requirement-2",
            patch: { content: "Change another artifact." },
          },
          {
            expectedEntityType: StructuralFragment.Requirement,
            expectedId: "requirement-1",
          },
        ),
      /unsupported field/,
    );
  });

  it("keeps the test-code path server-controlled", () => {
    assert.deepEqual(
      parseTestCodeProposal(
        { code: "// generated test\n" },
        "tests/scenario.test.ts",
      ),
      {
        path: "tests/scenario.test.ts",
        code: "// generated test\n",
      },
    );
    assert.throws(
      () =>
        parseTestCodeProposal(
          { path: "elsewhere.ts", code: "// generated test" },
          "tests/scenario.test.ts",
        ),
      /unsupported field/,
    );
  });

  it("bounds scaffold output and validates test-generation requests", () => {
    const definition: TestCaseDefinition = {
      kind: "behavioral",
      scenarioRevisionId: "scenario-r1",
      subjectId: "product",
      initialFixture: {},
      trace: [
        { id: "input", kind: "input", correlationAlias: "request", interfaceId: "api", interactionId: "review", payload: {}, captures: [] },
        { id: "output", kind: "output", correlationAlias: "request", interfaceId: "api", interactionId: "review", outcomeId: "complete", matcher: { kind: "schema" }, captures: [] },
      ],
      boundaryRevisionId: "boundary-r1",
      interfaceContractRevisionIds: ["interface-r1"],
      subjectContractRevisionId: "subject-r1",
    };
    const request = {
      project: {
        name: "Requireganizer",
        purpose: "Create traceable engineering artifacts.",
        framework: "Next.js",
        language: "TypeScript",
      },
      projectConfig: { testFramework: "node:test" },
      contracts: {
        boundaryRevisionId: "boundary-r1",
        interfaceContracts: [{
          interfaceId: "api",
          revisionId: "interface-r1",
          status: "approved",
          adapter: { id: "api-adapter", version: "1.0.0" },
        }],
        subjectContracts: [{
          subjectId: "product",
          revisionId: "subject-r1",
          status: "approved",
        }],
        verificationContracts: [],
      },
      scaffoldManifest: {
        language: "TypeScript",
        testTargets: [{
          scenarioId: "scenario-1",
          path: "tests/tsc-1-scenario.test.ts",
        }],
      },
      bindingMetadata: {
        adapterIds: ["api-adapter@1.0.0"],
        interfaceContractRevisionIds: ["interface-r1"],
        subjectContractRevisionIds: ["subject-r1"],
      },
      scenario: {
        id: "scenario-1",
        revisionId: "scenario-r1",
        code: "TSC-1",
        content: "Review traceability.",
        binding: {
          kind: "behavioral",
          subjectId: "product",
          interfaceIds: ["api"],
          boundaryRevisionId: "boundary-r1",
          interfaceContractRevisionIds: ["interface-r1"],
          subjectContractRevisionId: "subject-r1",
        },
      },
      testCase: {
        id: "case-1",
        revisionId: "case-r1",
        code: "TCS-1",
        title: "Preserve traceability",
        definition,
        renderedSteps: renderTestCaseSteps(definition),
        renderedExpectedResult: renderTestCaseExpectedResult(definition),
      },
      targetPath: "tests/tsc-1-scenario.test.ts",
      existingFile: null,
    };

    assert.equal(parseTestCodeRequest(request).targetPath, request.targetPath);
    assert.throws(
      () =>
        parseTestCodeRequest({
          ...request,
          testCase: { ...request.testCase, title: "Unsafe\nannotation" },
        }),
      /must be a single line/,
    );
    assert.throws(
      () =>
        parseTestCodeRequest({
          ...request,
          targetPath: "tests/invented.test.ts",
        }),
      /unique scaffold-manifest target/,
    );
    assert.throws(
      () =>
        parseTestCodeRequest({
          ...request,
          bindingMetadata: {
            ...request.bindingMetadata,
            adapterIds: ["wrong-adapter@1.0.0"],
          },
        }),
      /exact supplied contract revisions and adapters/,
    );
  });
});
