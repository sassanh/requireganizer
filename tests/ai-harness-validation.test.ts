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
  references: ["FEA-01"],
  dependencies: [],
  content: "As a kid, I want big buttons, so that I can calculate.",
};

const CODES_VERSION = "codes-1";

function parseStories(items: unknown) {
  return parseArtifactListProposal(
    { codesVersion: CODES_VERSION, items },
    { expectedEntityType: StructuralFragment.UserStory, state: userStoryState, codesVersion: CODES_VERSION },
  );
}

describe("artifact-list proposal parsing", () => {
  it("parses a valid story that covers its required upstream artifact", () => {
    const proposal = parseStories([validStory]);
    assert.equal(proposal.entityType, StructuralFragment.UserStory);
    assert.equal(proposal.items.length, 1);
    assert.equal(proposal.items[0].key, "story-1");
    assert.equal(proposal.items[0].priority, "p0");
    assert.deepEqual(proposal.items[0].references, [{ id: "feat-1", type: "primary_feature" }]);
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
    assert.match(parseError(() => parseArtifactListProposal(null, { expectedEntityType: StructuralFragment.UserStory, state: userStoryState, codesVersion: CODES_VERSION })), /must be an object/);
    assert.match(parseError(() => parseStories("nope")), /must be an array/);
    assert.match(parseError(() => parseStories([])), /must not be empty/);
  });

  it("refuses codes read before the lists last changed", () => {
    const parse = (value: Record<string, unknown>) =>
      parseArtifactListProposal(value, { expectedEntityType: StructuralFragment.UserStory, state: userStoryState, codesVersion: CODES_VERSION });
    assert.match(
      parseError(() => parse({ items: [validStory] })),
      /codesVersion must be the codesVersion of the get_items read/,
    );
    assert.match(
      parseError(() => parse({ codesVersion: "codes-0", items: [validStory] })),
      /^Codes may have moved since the get_items read with codesVersion codes-0: .* Read the items again with get_items/,
    );
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

  it("rejects an entry naming no existing item of its stage", () => {
    assert.match(
      parseError(() => parseStories([{ ...validStory, item: "US-09" }])),
      /names US-09, which is no existing user_story/,
    );
    assert.match(
      parseError(() => parseStories(["FEA-01"])),
      /names FEA-01, which is no existing user_story/,
    );
  });

  it("enforces reference existence, scope, uniqueness, and coverage", () => {
    assert.match(
      parseError(() => parseStories([{ ...validStory, references: [] }])),
      /references must not be empty/,
    );
    assert.match(
      parseError(() => parseStories([{ ...validStory, references: ["FEA-01", "feat-1"] }])),
      /references FEA-01 twice/,
    );
    assert.match(
      parseError(() => parseStories([{ ...validStory, references: ["FEA-07"] }])),
      /references FEA-07, which matches no item/,
    );
    assert.match(
      parseError(() => parseStories([{ ...validStory, references: [{ id: "feat-1", type: "primary_feature" }] }])),
      /references must hold codes/,
    );
    const stateWithRequirements = {
      ...userStoryState,
      requirements: [{ id: "req-1" }],
    };
    assert.match(
      parseError(() => parseArtifactListProposal(
        { codesVersion: CODES_VERSION, items: [{ ...validStory, references: ["REQ-01"] }] },
        { expectedEntityType: StructuralFragment.UserStory, state: stateWithRequirements, codesVersion: CODES_VERSION },
      )),
      /references REQ-01, outside this stage's allowed scope/,
    );
    assert.match(
      parseError(() => parseStories([{ ...validStory, references: ["USR-01"] }])),
      /does not cover FEA-01\./,
    );
  });

  it("validates dependency uniqueness, existence, self-reference, and cycles", () => {
    const second = { ...validStory, key: "story-2" };
    assert.match(
      parseError(() => parseStories([{ ...validStory, dependencies: ["story-2", "story-2"] }, second])),
      /New item "story-1" depends on New item "story-2" twice/,
    );
    assert.match(
      parseError(() => parseStories([{ ...validStory, dependencies: ["ghost-key"] }, second])),
      /depends on ghost-key, which is no item of this result/,
    );
    assert.match(
      parseError(() => parseStories([{ ...validStory, dependencies: ["story-1"] }])),
      /depends on itself/,
    );
    assert.match(
      parseError(() => parseStories([
        { ...validStory, key: "a", dependencies: ["b"] },
        { ...second, key: "b", dependencies: ["a"] },
      ])),
      /Dependencies form a cycle through/,
    );
  });

  it("rejects an item named twice and a key used twice", () => {
    const existing = {
      ...userStoryState,
      userStories: [{ id: "story-existing", content: "As a kid, I want big buttons.", priority: "p1", references: [{ id: "feat-1", type: "primary_feature" }], dependencies: [] }],
    };
    assert.match(
      parseError(() => parseArtifactListProposal({ codesVersion: CODES_VERSION, items: ["US-01", { item: "story-existing" }] }, { expectedEntityType: StructuralFragment.UserStory, state: existing, codesVersion: CODES_VERSION })),
      /names US-01 more than once/,
    );
    assert.match(
      parseError(() => parseStories([validStory, validStory])),
      /uses the key story-1 more than once/,
    );
  });

  it("takes an item out only when remove names it, and refuses a remove that disagrees with the list", () => {
    const story = (id: string, extra: Record<string, unknown> = {}) => ({
      id, content: "As a kid, I want big buttons.", priority: "p1", references: [{ id: "feat-1", type: "primary_feature" }], dependencies: [], ...extra,
    });
    const state = { ...userStoryState, userStories: [story("story-a"), story("story-b"), story("story-c", { pendingRemoval: true })] };
    const parse = (value: Record<string, unknown>) => parseArtifactListProposal(
      { codesVersion: CODES_VERSION, ...value },
      { expectedEntityType: StructuralFragment.UserStory, state, codesVersion: CODES_VERSION },
    );
    assert.deepEqual(parse({ items: ["US-01"], remove: ["US-2"] }).items.map(({ id }) => id), ["story-a"]);
    // An item already proposed for removal stays so, named in remove or not.
    assert.deepEqual(parse({ items: ["US-01", "US-02"] }).items.map(({ id }) => id), ["story-a", "story-b"]);
    assert.deepEqual(parseError(() => parse({ items: ["US-01", "US-03"], remove: ["US-01", "US-09", "FEA-01"] })).split("\n"), [
      "US-01 is both listed and in remove.",
      "Artifact result.remove names US-09, which is no existing user_story.",
      "Artifact result.remove names FEA-01, which is no existing user_story.",
      "US-02 is left out but not in remove: list it to keep it, or name it in remove to propose its removal.",
    ]);
  });

  it("reports every entry's problem at once, each by its code or key", () => {
    const message = parseError(() => parseStories([
      { ...validStory, references: ["FEA-07"] },
      { ...validStory, key: "story-2", content: "" },
      { ...validStory, key: "story-3", item: "US-04" },
    ]));
    assert.deepEqual(message.split("\n"), [
      'New item "story-1" references FEA-07, which matches no item.',
      'New item "story-2".content must be non-empty text.',
      "Artifact result.items[2] names US-04, which is no existing user_story.",
    ]);
  });

  describe("an entry that names an existing item", () => {
    const stories = {
      ...userStoryState,
      userStories: [
        {
          id: "story-a",
          content: "As a kid, I want big buttons, so that I can calculate.",
          priority: "p1",
          references: [{ id: "feat-1", type: "primary_feature" }],
          dependencies: [],
        },
        {
          id: "story-b",
          content: "As a kid, I want to undo, so that a mistake costs nothing.",
          priority: "p2",
          references: [{ id: "feat-1", type: "primary_feature" }],
          dependencies: ["story-a"],
        },
      ],
    };
    const parse = (items: unknown[]) =>
      parseArtifactListProposal({ codesVersion: CODES_VERSION, items }, { expectedEntityType: StructuralFragment.UserStory, state: stories, codesVersion: CODES_VERSION });

    it("changes only the fields it gives and keeps the rest", () => {
      const [a, b] = parse([
        "US-01",
        { item: "US-02", content: "As a kid, I want to undo, so that I try freely." },
      ]).items;
      assert.equal(a!.id, "story-a");
      assert.equal(b!.id, "story-b");
      assert.equal(b!.content, "As a kid, I want to undo, so that I try freely.");
      assert.equal(b!.priority, "p2");
      assert.deepEqual(b!.references, [{ id: "feat-1", type: "primary_feature" }]);
      assert.deepEqual(b!.dependencies, [a!.key]);
      // Links it gives replace the old ones, an empty list included.
      assert.deepEqual(parse(["US-01", { item: "US-02", dependencies: [] }]).items[1]!.dependencies, []);
    });

    it("is named by its code however padded, or by its id", () => {
      const ids = (items: unknown[]) => parse(items).items.map(({ id }) => id);
      assert.deepEqual(ids(["US-1", "story-b"]), ["story-a", "story-b"]);
      assert.deepEqual(ids([{ item: "US-001" }, "US-02"]), ["story-a", "story-b"]);
    });

    it("stays a dependency by its code or id whatever key its entry uses", () => {
      const [a, b, c] = parse([
        { item: "US-01", key: "renamed", content: "As a kid, I want huge buttons, so that I can calculate." },
        "US-02",
        { ...validStory, key: "new-story", dependencies: ["US-01", "story-b"] },
      ]).items;
      assert.equal(a!.key, "renamed");
      assert.deepEqual(b!.dependencies, ["renamed"]);
      assert.deepEqual(c!.dependencies, ["renamed", "story-b"]);
    });
  });
});

describe("product overview proposal parsing", () => {
  const state = {
    productOverview: {
      primaryFeatures: [{ id: "feat-1" }, { id: "feat-2" }],
      targetUsers: [{ id: "user-1" }],
    },
  };
  const parse = (primaryFeatures: unknown[]) => parseProductOverviewProposal(
    { codesVersion: CODES_VERSION, purpose: "Keep plants alive.", primaryFeatures, targetUsers: ["USR-01"] },
    { state, codesVersion: CODES_VERSION },
  );

  it("names existing items by code, and adds an item given as an object", () => {
    assert.deepEqual(parse(["FEA-02", { item: "FEA-1", content: "Track feeding" }, { content: "Track light" }]).primaryFeatures, [
      "feat-2",
      { id: "feat-1", content: "Track feeding" },
      { content: "Track light" },
    ]);
    assert.match(parseError(() => parse(["Track light"])), /names Track light, which is no existing primary_feature/);
  });

  it("takes a feature or target user out only when remove names it", () => {
    const parseWith = (remove: string[] | undefined) => parseProductOverviewProposal(
      { codesVersion: CODES_VERSION, purpose: "Keep plants alive.", primaryFeatures: ["FEA-01"], targetUsers: [{ content: "Gardeners" }], ...(remove == null ? {} : { remove }) },
      { state, codesVersion: CODES_VERSION },
    );
    assert.deepEqual(parseWith(["FEA-02", "USR-01"]).primaryFeatures, ["feat-1"]);
    assert.deepEqual(parseError(() => parseWith(undefined)).split("\n"), [
      "FEA-02 is left out but not in remove: list it to keep it, or name it in remove to propose its removal.",
      "USR-01 is left out but not in remove: list it to keep it, or name it in remove to propose its removal.",
    ]);
  });

  it("reports no removal for an item whose entry failed", () => {
    assert.equal(
      parseError(() => parse([{ item: "FEA-99", content: "Track feeding" }, "FEA-02"])),
      "Product overview.primaryFeatures[0] names FEA-99, which is no existing primary_feature.",
    );
  });

  it("rejects an item named twice, however it is named", () => {
    for (const entries of [["FEA-01", "FEA-02", "FEA-01"], ["FEA-01", { item: "FEA-01", content: "Track feeding" }, "FEA-02"], ["FEA-01", "feat-1", "FEA-02"]]) {
      assert.equal(parseError(() => parse(entries)), "Product overview.primaryFeatures names FEA-01 more than once.");
    }
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

  it("parses a remove patch", () => {
    const proposal = parseFragmentRevisionProposal(
      { patch: { remove: true } },
      { expectedEntityType: StructuralFragment.UserStory, expectedId: "story-1" },
    );
    assert.deepEqual(proposal.patch, { remove: true });
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
    assert.match(
      parseError(() => parseFragmentRevisionProposal({ patch: { remove: false } }, { expectedEntityType: StructuralFragment.UserStory, expectedId: "s" })),
      /remove must be true/,
    );
    assert.match(
      parseError(() => parseFragmentRevisionProposal({ patch: { remove: true, content: "x" } }, { expectedEntityType: StructuralFragment.UserStory, expectedId: "s" })),
      /cannot be combined/,
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
    revisionId: "interface-r1",
    interfaceId: "api",
    adapter: { id: "calc-adapter", version: "1.0.0" },
  }],
  subjectContracts: [{ revisionId: "subject-r1", subjectId: "calculator" }],
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
    project: { purpose: "Kids calculator", language: "TypeScript", framework: "node:test" },
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
          subjectContracts: [{ revisionId: "subject-r1", subjectId: "clock" }],
        },
      })),
      /do not exactly match the behavioral scenario binding/,
    );
    assert.match(
      parseError(() => parseTestCodeRequest({
        ...validTestCodeRequest(),
        contracts: { ...contracts, verificationContracts: [{ revisionId: "v-1", verificationObligationId: "vo-1" }] },
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
