import type { FieldDefinition, StageDefinition } from "workflow";

export const MODULE_OVERVIEW = "module-overview";
export const USER_STORIES = "user-stories";
export const REQUIREMENTS = "requirements";
export const ACCEPTANCE_CRITERIA = "acceptance-criteria";

export const PURPOSE = "purpose";
export const PRIMARY_FEATURE = "primary-feature";
export const TARGET_USER = "target-user";
export const USER_STORY = "user-story";
export const REQUIREMENT = "requirement";
export const ACCEPTANCE_CRITERION = "acceptance-criterion";

const TEXT: FieldDefinition = { name: "text", label: "Text", type: "text", required: true };
const PRIORITY: FieldDefinition = { name: "priority", label: "Priority", type: "priority", required: false };

const SHARED_RULES = [
  "A reference links an item to an item of a stage this stage builds on; a dependency links it to an item of its own stage or of another module that it relies on.",
  "An item is signed as it is shown. Write each item so that it can be judged on its own.",
];

const rules = (lines: readonly string[]) => [...lines, ...SHARED_RULES].map((line) => `- ${line}`).join("\n");

/** The stages of Requirements engineering, as the workflow engine takes them. */
export const REQUIREMENTS_ENGINEERING_STAGES: readonly StageDefinition[] = [
  {
    id: MODULE_OVERVIEW,
    label: "Module Overview",
    buildsOn: [],
    kinds: [
      { kind: PURPOSE, label: "Purpose", plural: "Purpose", code: "PUR", single: true, fields: [TEXT] },
      { kind: PRIMARY_FEATURE, label: "Primary feature", plural: "Primary features", code: "FEA", fields: [TEXT] },
      { kind: TARGET_USER, label: "Target user", plural: "Target users", code: "USR", fields: [TEXT] },
    ],
    rules: rules([
      "The purpose states whom the module helps and what changes for them.",
      "Each primary feature states in one sentence one capability a user would recognise: what the user can do with it, not how it behaves in detail.",
      "Each target user names a kind of person or role and describes it in one sentence.",
      "The purpose and the primary features name no technology, architecture or way of building the product.",
    ]),
  },
  {
    id: USER_STORIES,
    label: "User Stories",
    buildsOn: [{ stage: MODULE_OVERVIEW, covers: [PRIMARY_FEATURE] }],
    kinds: [{ kind: USER_STORY, label: "User story", plural: "User stories", code: "US", fields: [TEXT, PRIORITY] }],
    rules: rules([
      'A user story reads "As a <target user>, I want <outcome>, so that <reason>".',
      "A user story references the primary features and the target users it serves, and at least one primary feature.",
      "A primary feature is covered when the stories referencing it give every outcome its users need from it.",
      "A priority says what gives way first when not everything can be delivered: p2 gives way first, p0 last.",
    ]),
  },
  {
    id: REQUIREMENTS,
    label: "Requirements",
    buildsOn: [{ stage: USER_STORIES, covers: [USER_STORY] }],
    kinds: [{ kind: REQUIREMENT, label: "Requirement", plural: "Requirements", code: "REQ", fields: [TEXT, PRIORITY] }],
    rules: rules([
      'A requirement reads "The system must …" and states one obligation that can be verified on its own and chooses nothing of how the product is built.',
      "A requirement references the user stories it delivers, and at least one.",
      "A user story is covered when the requirements referencing it ask for all the behaviour its outcome needs.",
      "A priority says what gives way first when not everything can be delivered: p2 gives way first, p0 last.",
    ]),
  },
  {
    id: ACCEPTANCE_CRITERIA,
    label: "Acceptance Criteria",
    buildsOn: [{ stage: REQUIREMENTS, covers: [REQUIREMENT] }],
    kinds: [
      {
        kind: ACCEPTANCE_CRITERION,
        label: "Acceptance criterion",
        plural: "Acceptance criteria",
        code: "AC",
        fields: [TEXT, PRIORITY],
      },
    ],
    rules: rules([
      "An acceptance criterion reads as a Given, a When and a Then; the When is left out for a state that holds with no event.",
      "A criterion uses the words of what the module is about and names nothing of the product's technology.",
      "A criterion references the requirements it decides, and at least one.",
      "A requirement is covered when its criteria decide each case it distinguishes, each refusal it states included.",
    ]),
  },
];
