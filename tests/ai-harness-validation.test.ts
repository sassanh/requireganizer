import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseArtifactListProposal,
  parseFragmentRevisionProposal,
  parseTestCodeProposal,
  parseTestCodeRequest,
} from "../app/ai-harness/validation";
import {
  parseTestCaseDefinition,
  renderTestCaseExpectedResult,
  renderTestCaseSteps,
} from "../app/contract-domain";
import { StructuralFragment } from "../app/store/constants";

function parseError(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("Expected the parser to throw, but it succeeded.");
}

// ---------------------------------------------------------------------------
// Artifact-list proposals (parseArtifactListProposal family)
// ---------------------------------------------------------------------------

const userStoryState = {
  productOverview: {
    primaryFeatures: [{ id: "feat-1" }],
    targetUsers: [{ id: "user-1" }],
  },
  userStories: [],
  requirements: [],
  acceptanceCriteria: [],
};

const validStory = {
  key: "story-1",
  priority: "p0",
  references: [{ id: "feat-1", type: "primary_feature" }],
  dependencies: [],
  content: "As a kid, I want big buttons, so that I can calculate.",
};

function parseStories(items: unknown) {
  return parseArtifactListProposal(
    { items },
    { expectedEntityType: StructuralFragment.UserStory, state: userStoryState },
  );
}

describe("artifact-list proposal parsing", () => {
  it("parses a valid story that covers its required upstream artifact", () => {
    const proposal = parseStories([validStory]);
    assert.equal(proposal.entityType, StructuralFragment.UserStory);
    assert.equal(proposal.items.length, 1);
    assert.equal(proposal.items[0].key, "story-1");
    assert.equal(proposal.items[0].priority, "p0");
  });

  it("does not reject writing quality in code", () => {
    const domainLanguage = parseStories([
      {
        ...validStory,
        content:
          "As a teacher, I want materials that support intuitive education, so that students can learn at their own pace.",
      },
    ]);
    assert.match(domainLanguage.items[0].content, /intuitive education/);

    const freeForm = parseStories([
      {
        ...validStory,
        content: "Teachers need materials that support intuitive education.",
      },
    ]);
    assert.equal(
      freeForm.items[0].content,
      "Teachers need materials that support intuitive education.",
    );
  });

  it("rejects non-object results, missing items, and empty item lists", () => {
    assert.match(parseError(() => parseArtifactListProposal(null, { expectedEntityType: StructuralFragment.UserStory, state: userStoryState })), /must be an object/);
    assert.match(parseError(() => parseStories("nope")), /must be an array/);
    assert.match(parseError(() => parseStories([])), /must not be empty/);
  });

  it("rejects items with unsupported fields or malformed keys", () => {
    assert.match(
      parseError(() => parseStories([{ ...validStory, surprise: 1 }])),
      /unsupported field\(s\): surprise/,
    );
    assert.match(
      parseError(() => parseStories([{ ...validStory, key: "-starts-bad" }])),
      /key must be 1-80 letters/,
    );
    assert.match(
      parseError(() => parseStories([{ ...validStory, key: "x".repeat(81) }])),
      /key must be 1-80 letters/,
    );
  });

  it("rejects preserved ids outside the existing target set", () => {
    assert.match(
      parseError(() => parseStories([{ ...validStory, id: "ghost-story" }])),
      /must identify an existing target item/,
    );
  });

  it("enforces reference existence, scope, uniqueness, and coverage", () => {
    assert.match(
      parseError(() => parseStories([{ ...validStory, references: [] }])),
      /references must not be empty/,
    );
    assert.match(
      parseError(() => parseStories([{ ...validStory, references: [{ id: "feat-1", type: "primary_feature" }, { id: "feat-1", type: "primary_feature" }] }])),
      /duplicate reference feat-1/,
    );
    assert.match(
      parseError(() => parseStories([{ ...validStory, references: [{ id: "ghost", type: "primary_feature" }] }])),
      /does not identify an existing primary_feature/,
    );
    assert.match(
      parseError(() => parseStories([{ ...validStory, references: [{ id: "feat-1", type: "user_story" }] }])),
      /does not identify an existing user_story/,
    );
    const stateWithRequirements = {
      ...userStoryState,
      requirements: [{ id: "req-1" }],
    };
    assert.match(
      parseError(() => parseArtifactListProposal(
        { items: [{ ...validStory, references: [{ id: "req-1", type: "requirement" }] }] },
        { expectedEntityType: StructuralFragment.UserStory, state: stateWithRequirements },
      )),
      /outside this stage's allowed scope/,
    );
    assert.match(
      parseError(() => parseStories([{ ...validStory, references: [{ id: "user-1", type: "target_user" }] }])),
      /does not cover 1 required upstream artifact/,
    );
  });

  it("validates dependency uniqueness, existence, self-reference, and cycles", () => {
    const second = { ...validStory, key: "story-2", references: [{ id: "feat-1", type: "primary_feature" }] };
    assert.match(
      parseError(() => parseStories([{ ...validStory, dependencies: ["story-2", "story-2"] }, second])),
      /duplicate dependency story-2/,
    );
    assert.match(
      parseError(() => parseStories([{ ...validStory, dependencies: ["ghost-key"] }, second])),
      /depends on unknown proposal key ghost-key/,
    );
    assert.match(
      parseError(() => parseStories([{ ...validStory, dependencies: ["story-1"] }])),
      /cannot depend on itself/,
    );
    assert.match(
      parseError(() => parseStories([
        { ...validStory, key: "a", dependencies: ["b"] },
        { ...second, key: "b", dependencies: ["a"] },
      ])),
      /must not contain cycles/,
    );
  });

  it("rejects duplicate preserved ids and duplicate proposal keys", () => {
    const existing = {
      ...userStoryState,
      userStories: [{ id: "story-existing" }],
    };
    const item = { ...validStory, id: "story-existing" };
    assert.match(
      parseError(() => parseArtifactListProposal({ items: [item, item] }, { expectedEntityType: StructuralFragment.UserStory, state: existing })),
      /duplicate item ids/,
    );
    assert.match(
      parseError(() => parseStories([validStory, validStory])),
      /duplicate proposal keys/,
    );
  });
});

describe("fragment revision proposal parsing", () => {
  it("parses content and priority patches", () => {
    const proposal = parseFragmentRevisionProposal(
      { patch: { content: "Revised", priority: "p1" } },
      { expectedEntityType: StructuralFragment.UserStory, expectedId: "story-1" },
    );
    assert.deepEqual(proposal.patch, { content: "Revised", priority: "p1" });
  });

  it("rejects contract-first entities, unknown fields, empty patches, and bad values", () => {
    assert.match(
      parseError(() => parseFragmentRevisionProposal({ patch: { content: "x" } }, { expectedEntityType: StructuralFragment.TestCase, expectedId: "case-1" })),
      /contract-first revision flow/,
    );
    assert.match(
      parseError(() => parseFragmentRevisionProposal({ patch: { title: "x" } }, { expectedEntityType: StructuralFragment.UserStory, expectedId: "s" })),
      /patch.title is not allowed/,
    );
    assert.match(
      parseError(() => parseFragmentRevisionProposal({ patch: {} }, { expectedEntityType: StructuralFragment.UserStory, expectedId: "s" })),
      /must contain a change/,
    );
    assert.match(
      parseError(() => parseFragmentRevisionProposal({ patch: { priority: "urgent" } }, { expectedEntityType: StructuralFragment.UserStory, expectedId: "s" })),
      /unsupported value/,
    );
  });
});

describe("test-code proposal parsing", () => {
  it("keeps whitespace and rejects empties, extra fields, and oversize code", () => {
    const proposal = parseTestCodeProposal({ code: "  const x = 1;\n" }, "tests/add.test.ts");
    assert.equal(proposal.code, "  const x = 1;\n");
    assert.equal(proposal.path, "tests/add.test.ts");
    assert.match(
      parseError(() => parseTestCodeProposal({ code: "  " }, "tests/add.test.ts")),
      /must be non-empty text/,
    );
    assert.match(
      parseError(() => parseTestCodeProposal({ code: "x", note: "extra" }, "tests/add.test.ts")),
      /unsupported field\(s\): note/,
    );
    assert.match(
      parseError(() => parseTestCodeProposal({ code: "x".repeat(500_001) }, "tests/add.test.ts")),
      /exceeds the response size limit/,
    );
  });
});

// ---------------------------------------------------------------------------
// Test-code requests (parseTestCodeRequest)
// ---------------------------------------------------------------------------

const behavioralDefinition = {
  kind: "behavioral",
  scenarioRevisionId: "scenario-r1",
  subjectId: "calculator",
  initialFixture: {},
  boundaryRevisionId: "boundary-r1",
  interfaceContractRevisionIds: ["interface-r1"],
  subjectContractRevisionId: "subject-r1",
  trace: [
    { id: "input-1", kind: "input", correlationAlias: "addition-1", interfaceId: "api", interactionId: "add", payload: { left: 1, right: 2 }, captures: [] },
    { id: "output-1", kind: "output", correlationAlias: "addition-1", interfaceId: "api", interactionId: "add", outcomeId: "sum", matcher: { kind: "exact", value: { value: 3 } }, captures: [] },
  ],
};

const behavioralBinding = {
  kind: "behavioral",
  subjectId: "calculator",
  interfaceIds: ["api"],
  boundaryRevisionId: "boundary-r1",
  interfaceContractRevisionIds: ["interface-r1"],
  subjectContractRevisionId: "subject-r1",
};

const contracts = {
  boundaryRevisionId: "boundary-r1",
  interfaceContracts: [{
    status: "approved",
    revisionId: "interface-r1",
    interfaceId: "api",
    adapter: { id: "calc-adapter", version: "1.0.0" },
  }],
  subjectContracts: [{ status: "approved", revisionId: "subject-r1", subjectId: "calculator" }],
  verificationContracts: [],
};

const bindingMetadata = {
  adapterIds: ["calc-adapter@1.0.0"],
  interfaceContractRevisionIds: ["interface-r1"],
  subjectContractRevisionIds: ["subject-r1"],
};

const scaffoldManifest = {
  language: "TypeScript",
  testTargets: [{ scenarioId: "scenario-1", path: "tests/add.test.ts" }],
};

function validTestCodeRequest() {
  return {
    project: { name: "TinyCalc", purpose: "Kids calculator", language: "TypeScript", framework: "node:test" },
    projectConfig: { runner: "node:test" },
    contracts,
    scaffoldManifest,
    bindingMetadata,
    scenario: {
      id: "scenario-1",
      revisionId: "scenario-r1",
      code: "SCN-1",
      content: "Adding two numbers",
      binding: behavioralBinding,
    },
    testCase: {
      id: "case-1",
      revisionId: "case-r1",
      code: "CASE-1",
      title: "Adds two numbers",
      definition: behavioralDefinition,
      renderedSteps: renderTestCaseSteps(behavioralDefinition as never),
      renderedExpectedResult: renderTestCaseExpectedResult(behavioralDefinition as never),
    },
    targetPath: "tests/add.test.ts",
    existingFile: null,
  };
}

describe("test-code request parsing", () => {
  it("parses a complete, internally consistent request", () => {
    const request = parseTestCodeRequest(validTestCodeRequest());
    assert.equal(request.project.name, "TinyCalc");
    assert.equal(request.scenario.id, "scenario-1");
    assert.equal(request.testCase.id, "case-1");
    assert.equal(request.targetPath, "tests/add.test.ts");
    assert.equal(request.existingFile, null);
    assert.deepEqual(request.bindingMetadata.adapterIds, ["calc-adapter@1.0.0"]);
  });

  it("rejects non-object requests and unsupported fields at every level", () => {
    assert.match(parseError(() => parseTestCodeRequest("nope")), /must be an object/);
    assert.match(
      parseError(() => parseTestCodeRequest({ ...validTestCodeRequest(), extra: 1 })),
      /unsupported field\(s\): extra/,
    );
    assert.match(
      parseError(() => parseTestCodeRequest({ ...validTestCodeRequest(), project: { ...validTestCodeRequest().project, extra: 1 } })),
      /Test-code request\.project contains unsupported field\(s\): extra/,
    );
  });

  it("rejects unsafe target paths and mismatched existing files", () => {
    assert.match(
      parseError(() => parseTestCodeRequest({ ...validTestCodeRequest(), targetPath: "../escape.test.ts" })),
      /safe, relative POSIX paths/,
    );
    assert.match(
      parseError(() => parseTestCodeRequest({ ...validTestCodeRequest(), existingFile: { path: "tests/other.test.ts", content: "x" } })),
      /must match targetPath/,
    );
    assert.match(
      parseError(() => parseTestCodeRequest({ ...validTestCodeRequest(), existingFile: { path: "tests/add.test.ts", content: 5 } })),
      /existingFile\.content must be text/,
    );
  });

  it("rejects empty comments and malformed binding metadata", () => {
    assert.match(
      parseError(() => parseTestCodeRequest({ ...validTestCodeRequest(), comment: "   " })),
      /comment must not be empty/,
    );
    assert.match(
      parseError(() => parseTestCodeRequest({ ...validTestCodeRequest(), bindingMetadata: { ...bindingMetadata, extra: 1 } })),
      /bindingMetadata contains unsupported field\(s\): extra/,
    );
    assert.match(
      parseError(() => parseTestCodeRequest({ ...validTestCodeRequest(), bindingMetadata: { ...bindingMetadata, adapterIds: [42] } })),
      /adapterIds must be a text array/,
    );
    assert.match(
      parseError(() => parseTestCodeRequest({
        ...validTestCodeRequest(),
        bindingMetadata: { ...bindingMetadata, interfaceContractRevisionIds: [] },
      })),
      /must identify the exact supplied contract revisions/,
    );
  });

  it("rejects definition/binding inconsistencies", () => {
    assert.match(
      parseError(() => parseTestCodeRequest({
        ...validTestCodeRequest(),
        scenario: { ...validTestCodeRequest().scenario, revisionId: "scenario-r2" },
      })),
      /must bind the exact scenario revision/,
    );
    assert.match(
      parseError(() => parseTestCodeRequest({
        ...validTestCodeRequest(),
        scenario: {
          ...validTestCodeRequest().scenario,
          binding: { ...behavioralBinding, subjectId: "clock" },
        },
      })),
      /must bind the scenario's exact subject and contract revisions/,
    );
  });

  it("rejects contract sets that do not exactly match the binding", () => {
    assert.match(
      parseError(() => parseTestCodeRequest({
        ...validTestCodeRequest(),
        contracts: { ...contracts, boundaryRevisionId: "boundary-r2" },
      })),
      /different boundary revision/,
    );
    assert.match(
      parseError(() => parseTestCodeRequest({
        ...validTestCodeRequest(),
        contracts: {
          ...contracts,
          interfaceContracts: [{
            ...contracts.interfaceContracts[0],
            status: "draft",
          }],
        },
      })),
      /must be approved/,
    );
    assert.match(
      parseError(() => parseTestCodeRequest({
        ...validTestCodeRequest(),
        contracts: {
          ...contracts,
          subjectContracts: [{ status: "approved", revisionId: "subject-r1", subjectId: "clock" }],
        },
      })),
      /do not exactly match the behavioral scenario binding/,
    );
    assert.match(
      parseError(() => parseTestCodeRequest({
        ...validTestCodeRequest(),
        contracts: { ...contracts, verificationContracts: [{ status: "approved", revisionId: "v-1", verificationObligationId: "vo-1" }] },
      })),
      /do not exactly match the behavioral scenario binding/,
    );
  });

  it("rejects scaffold manifests that disagree with the project or target", () => {
    assert.match(
      parseError(() => parseTestCodeRequest({
        ...validTestCodeRequest(),
        scaffoldManifest: { ...scaffoldManifest, language: "Rust" },
      })),
      /must match the scaffold manifest/,
    );
    assert.match(
      parseError(() => parseTestCodeRequest({
        ...validTestCodeRequest(),
        scaffoldManifest: { ...scaffoldManifest, testTargets: [] },
      })),
      /unique scaffold-manifest target/,
    );
    assert.match(
      parseError(() => parseTestCodeRequest({
        ...validTestCodeRequest(),
        targetPath: "tests/multiply.test.ts",
        scaffoldManifest: {
          ...scaffoldManifest,
          testTargets: [
            { scenarioId: "scenario-1", path: "tests/add.test.ts" },
            { scenarioId: "scenario-1", path: "tests/multiply.test.ts" },
          ],
        },
      })),
      /unique scaffold-manifest target/,
    );
  });

  it("rejects human-readable renderings that were not derived from the definition", () => {
    assert.match(
      parseError(() => parseTestCodeRequest({
        ...validTestCodeRequest(),
        testCase: { ...validTestCodeRequest().testCase, renderedSteps: "hand-written steps" },
      })),
      /must be rendered from its structured definition/,
    );
  });
});
