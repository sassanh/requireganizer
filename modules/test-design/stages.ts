import { ACCEPTANCE_CRITERIA, ACCEPTANCE_CRITERION } from "requirements-engineering";
import type { StageDefinition, TextFieldDefinition } from "workflow";

import { checkAbstractTest, displayAbstractTest, marksOfAbstractTest, ROW_FIELDS, STEP_FIELDS, THEN_FIELDS } from "./abstractTests";
import { checkEntityType, checkOperation, checkWordSet, displayBoundaryStatement, displayOperation } from "./boundary";
import { ABSTRACT_TEST, ABSTRACT_TESTS, BOUNDARY, BOUNDARY_STATEMENT, ENTITY_TYPE, OPERATION, OPERATION_KINDS, WORD_SET } from "./identifiers";
import { TYPE_FIELDS } from "./valueTypes";

const text = (name: string, label: string, description: string, required = true): TextFieldDefinition => ({
  name,
  label,
  description,
  type: "text",
  required,
});

/** A rule of operations and of entity types. */
const CRITERIA_WORDS = "An operation's phrase, and an entity type's name and what it is, use the words of the acceptance criteria.";

/** A rule of entity types and of sets of words. */
const NAMED_BY_AN_OPERATION = "Every entity type and every set of words the boundary holds is named by some operation.";

/** The stages of Test design, as the workflow engine takes them. */
export const TEST_DESIGN_STAGES: readonly StageDefinition[] = [
  {
    id: BOUNDARY,
    label: "Boundary",
    buildsOn: [ACCEPTANCE_CRITERIA],
    kinds: [
      {
        kind: BOUNDARY_STATEMENT,
        label: "Boundary statement",
        plural: "Boundary statement",
        code: "BND",
        single: true,
        question: "What do the module's tests act on and observe, what do they leave out, and which state does every test of the module start from?",
        rules: ["The starting state holds no entity."],
        fields: [
          text("actsOn", "Acts on and observes", "What the module's tests act on and observe."),
          text("leavesOut", "Leaves out", "What the module's tests leave out.", false),
          text("startingState", "Starting state", "The state every abstract test of the module starts from."),
        ],
        display: displayBoundaryStatement,
      },
      {
        kind: ENTITY_TYPE,
        label: "Entity type",
        plural: "Entity types",
        code: "ENT",
        question: "Which thing does a test get as one step's result and refer to by name in later steps?",
        rules: [CRITERIA_WORDS, NAMED_BY_AN_OPERATION],
        fields: [
          text("name", "Name", "The name of the entities, unique in the boundary."),
          text("meaning", "What it is", "What such an entity is, as seen at the boundary."),
        ],
        check: checkEntityType,
        display: (parts) => `${parts.text("name")}: ${parts.text("meaning")}`,
      },
      {
        kind: WORD_SET,
        label: "Set of words",
        plural: "Sets of words",
        code: "SET",
        question: "Which words can an input or a result be, when it can be only one of them?",
        rules: [NAMED_BY_AN_OPERATION],
        fields: [
          text("name", "Name", "The name of the set, unique in the boundary."),
          { name: "words", label: "Words", description: "The words a value of the set can be, at least one, each once.", type: "texts", required: true },
        ],
        check: checkWordSet,
        display: (parts) => `${parts.text("name")}: ${(parts.content.words as readonly string[] | null ?? []).join(", ")}`,
      },
      {
        kind: OPERATION,
        label: "Operation",
        plural: "Operations",
        code: "OP",
        question:
          "What can a test do or see at the boundary that an acceptance criterion needs: as an action, the product's own behaviour under test; as an observation, a value the product holds or shows, reported without computing or comparing anything; or as a direct setup, a state put in place that the product's own actions cannot build?",
        rules: [
          "An operation acts on and observes only what the boundary statement says the module's tests act on and observe.",
          CRITERIA_WORDS,
          "Operations are written for the acceptance criteria as best understood, and an operation found missing while writing abstract tests is added then.",
        ],
        fields: [
          text("name", "Name", "A short name, unique in the boundary."),
          {
            name: "kind",
            label: "Kind",
            description: "direct setup, action or observation.",
            type: "choice",
            options: OPERATION_KINDS,
            required: true,
          },
          text("phrase", "Phrase", "What it does at the boundary, with a place for each input written as its name in braces, such as {quantity}."),
          {
            name: "inputs",
            label: "Inputs",
            entry: "input",
            description: "Its inputs, each with a name unique in the operation and a type.",
            type: "records",
            fields: [
              text("name", "Name", "The input's name, as its place in the phrase writes it."),
              { name: "type", label: "Type", description: "The input's type.", type: "record", fields: TYPE_FIELDS, required: true },
            ],
            required: false,
          },
          { name: "result", label: "Result", description: "The type of its result; none when it returns nothing. An observation always has one.", type: "record", fields: TYPE_FIELDS, required: false },
          {
            name: "refusals",
            label: "Refusals",
            entry: "refusal",
            description: "For an action only: the refusals it can give, each with a name unique in the action and its meaning.",
            type: "records",
            fields: [text("name", "Name", "The refusal's name."), text("meaning", "Meaning", "What the refusal means.")],
            required: false,
          },
          { name: "completesLater", label: "Completes later", description: "For an action or an observation: it completes some time after it is called.", type: "flag", required: false },
          text("reason", "Reason", "For a direct setup only, and required there: why the product's actions cannot build the state it puts in place.", false),
        ],
        mustReference: [{ kinds: [ACCEPTANCE_CRITERION] }],
        dependsOnSingle: [BOUNDARY_STATEMENT],
        check: checkOperation,
        display: displayOperation,
        example: {
          name: "lend book",
          kind: "action",
          phrase: "lend {book} to {member}",
          inputs: [
            { name: "book", type: { entity: "ENT-01" } },
            { name: "member", type: { entity: "ENT-02" } },
          ],
          result: { entity: "ENT-03" },
          refusals: [{ name: "already lent", meaning: "another member holds the book" }],
          completesLater: false,
        },
      },
    ],
  },
  {
    id: ABSTRACT_TESTS,
    label: "Abstract tests",
    buildsOn: [ACCEPTANCE_CRITERIA, BOUNDARY],
    kinds: [
      {
        kind: ABSTRACT_TEST,
        label: "Abstract test",
        plural: "Abstract tests",
        code: "AT",
        question: "Which steps, using only the boundary's operations, with which concrete values, check one acceptance criterion?",
        rules: [
          "Each test starts from the boundary statement's starting state and builds in its Given everything its steps use.",
          "A test's When does what its criterion's When says, and is empty when the criterion has none.",
          "A step whose operation completes later completes when the operation does, and the next step starts only after it.",
          "How long a step took runs from when the product starts its operation until the product completes it, measured inside the product, so that no time spent reaching the product or reporting back is counted.",
          "A step still running when the time limit a Then step compares it with passes took longer than that limit.",
          "A test passes when every Then step holds; fails when a Then step does not hold, or when a When step or a Then step's observation does not complete, ends with an error it does not declare, or is refused without a Then step expecting it; and is inconclusive when a Given step does not complete.",
          "A step refused as a Then step expects counts as completed, and the test goes on.",
          "Tests of one criterion that differ only in their values are written as one test with a table.",
          "Each row of a test's table counts as one test, for its verdict and for its criterion's coverage.",
          "An acceptance criterion is covered when its tests include one for each case it distinguishes, refusals included, and, at each edge of a range of input values it allows, one at the edge value and one at the nearest value beyond it, at the precision the criterion states.",
          "An acceptance criterion needing anything the boundary statement leaves out gets no abstract test, and its coverage is signed as untested.",
          "An operation is covered when some test uses it and, for each refusal it declares, some test expects that refusal.",
        ],
        fields: [
          {
            name: "criterion",
            label: "Acceptance criterion",
            description: "The one acceptance criterion the test verifies, by code.",
            type: "items",
            of: ACCEPTANCE_CRITERION,
            shows: "then",
            single: true,
            required: true,
          },
          { name: "given", label: "Given", entry: "Given step", description: "Steps calling actions, direct setups or observations that build what the test starts from.", type: "records", fields: STEP_FIELDS, required: false },
          { name: "when", label: "When", entry: "When step", description: "Steps calling actions.", type: "records", fields: STEP_FIELDS, required: false },
          { name: "then", label: "Then", entry: "Then step", description: "The expectations, at least one.", type: "records", fields: THEN_FIELDS, required: true },
          {
            name: "columns",
            label: "Table columns",
            entry: "column",
            description: "For a test written once for several sets of values: the table's columns, each with a name and a type other than an entity type or a list of entities, each used by some step.",
            type: "records",
            fields: [
              text("name", "Name", "The column's name, which steps use in place of a value."),
              { name: "type", label: "Type", description: "The column's type.", type: "record", fields: TYPE_FIELDS, required: true },
            ],
            required: false,
          },
          {
            name: "rows",
            label: "Table rows",
            entry: "row",
            description: "One row per test, giving each column one value, written out or chosen empty, in the columns' order.",
            type: "records",
            fields: ROW_FIELDS,
            required: false,
          },
        ],
        covers: [ACCEPTANCE_CRITERION, OPERATION],
        check: (content, module) => checkAbstractTest(content, module),
        display: displayAbstractTest,
        marks: marksOfAbstractTest,
        example: {
          criterion: "AC-01",
          given: [
            { name: "dune", operation: "OP-01", inputs: [{ input: "title", literal: '"Dune"' }] },
            { name: "ana", operation: "OP-02", inputs: [{ input: "name", literal: '"Ana"' }] },
            { name: "loan", operation: "OP-03", inputs: [{ input: "book", step: "dune" }, { input: "member", step: "ana" }] },
            { operation: "OP-04", inputs: [{ input: "days", column: "days" }] },
          ],
          when: [{ operation: "OP-05", inputs: [{ input: "loan", step: "loan" }] }],
          then: [{ expects: "observation", operation: "OP-06", inputs: [{ input: "loan", step: "loan" }], comparison: "equals", expected: { literal: "21" } }],
          columns: [{ name: "days", type: { simple: "whole number" } }],
          rows: [{ cells: [{ literal: "0" }] }, { cells: [{ literal: "21" }] }],
        },
      },
    ],
  },
];
