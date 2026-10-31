import type { FieldDefinition, StageDefinition, TextFieldDefinition } from "workflow";

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

/** P2 gives way first and P0 last. */
export const PRIORITIES = ["P0", "P1", "P2"] as const;

/** The words a requirement's obligation follows. */
export const SYSTEM_MUST = "The system must";

const PRIORITY: FieldDefinition = {
  name: "priority",
  label: "Priority",
  description: "What gives way first when not everything can be delivered: P2 first, P0 last.",
  type: "choice",
  options: PRIORITIES,
  required: false,
};

const text = (name: string, label: string, description: string, required = true): TextFieldDefinition => ({
  name,
  label,
  description,
  type: "text",
  required,
});

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
      {
        kind: PURPOSE,
        label: "Purpose",
        plural: "Purpose",
        code: "PUR",
        single: true,
        fields: [text("text", "Purpose", "Whom the module helps and what changes for them.")],
        display: (parts) => parts.text("text"),
      },
      {
        kind: PRIMARY_FEATURE,
        label: "Primary feature",
        plural: "Primary features",
        code: "FEA",
        fields: [text("text", "Feature", "One sentence stating one capability a user would recognise.")],
        display: (parts) => parts.text("text"),
      },
      {
        kind: TARGET_USER,
        label: "Target user",
        plural: "Target users",
        code: "USR",
        fields: [
          text("name", "Name", 'The kind of person or role, as a user story names it after "As a", such as "spec owner".'),
          text("description", "Description", "One sentence describing that kind of person or role."),
        ],
        display: (parts) => `${parts.text("name")}: ${parts.text("description")}`,
      },
    ],
    rules: rules([
      "The purpose states whom the module helps and what changes for them.",
      "Each primary feature states in one sentence one capability a user would recognise: what the user can do with it, not how it behaves in detail.",
      'Each target user has a name, the kind of person or role that user stories use after "As a", and a one-sentence description of it. Both are required.',
      "The purpose and the primary features name no technology, architecture or way of building the product.",
    ]),
  },
  {
    id: USER_STORIES,
    label: "User Stories",
    buildsOn: [{ stage: MODULE_OVERVIEW, covers: [PRIMARY_FEATURE] }],
    kinds: [
      {
        kind: USER_STORY,
        label: "User story",
        plural: "User stories",
        code: "US",
        fields: [
          {
            name: "targetUsers",
            label: "Target users",
            description: "The target users the story is for, chosen from the module's target users; usually one.",
            type: "items",
            of: TARGET_USER,
            shows: "name",
            required: true,
          },
          text("outcome", "Outcome", 'What they want, as it follows "I want".'),
          text("reason", "Reason", 'Why they want it, as it follows "so that".'),
          PRIORITY,
        ],
        mustReference: [PRIMARY_FEATURE],
        display: (parts) => `As a ${parts.names("targetUsers").join(" or ")}, I want ${parts.text("outcome")}, so that ${parts.text("reason")}`,
      },
    ],
    rules: rules([
      'A user story has three parts, all required: the target users it is for, chosen from the module\'s target users (usually one), the outcome they want, and the reason they want it. It reads "As a <target user>, I want <outcome>, so that <reason>", several target users joined with "or".',
      "A user story references the primary features it serves, at least one. It counts as referencing each of its target users, so its references do not list them again.",
      "A primary feature is covered when the stories referencing it give every outcome its users need from it.",
      "A priority, P0, P1 or P2, says what gives way first when not everything can be delivered: P2 gives way first, P0 last.",
    ]),
  },
  {
    id: REQUIREMENTS,
    label: "Requirements",
    buildsOn: [{ stage: USER_STORIES, covers: [USER_STORY] }],
    kinds: [
      {
        kind: REQUIREMENT,
        label: "Requirement",
        plural: "Requirements",
        code: "REQ",
        fields: [
          { ...text("obligation", "Obligation", `What follows "${SYSTEM_MUST}", without those words.`), prefix: SYSTEM_MUST },
          PRIORITY,
        ],
        mustReference: [USER_STORY],
        display: (parts) => `${SYSTEM_MUST} ${parts.text("obligation")}`,
      },
    ],
    rules: rules([
      'A requirement holds the obligation that follows "The system must" and reads with those words in front.',
      "A requirement states one obligation that can be verified on its own and chooses nothing of how the product is built.",
      "A requirement references the user stories it delivers, at least one.",
      "A user story is covered when the requirements referencing it ask for all the behaviour its outcome needs.",
      "A priority, P0, P1 or P2, says what gives way first when not everything can be delivered: P2 gives way first, P0 last.",
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
        fields: [
          text("given", "Given", "The starting situation."),
          text("when", "When", "The event, if there is one; left empty for a state that holds with no event.", false),
          text("then", "Then", "The outcome anyone can check."),
        ],
        mustReference: [REQUIREMENT],
        display: (parts) => [`Given ${parts.text("given")}`, ...(parts.text("when") === "" ? [] : [`When ${parts.text("when")}`]), `Then ${parts.text("then")}`].join("\n"),
      },
    ],
    rules: rules([
      "An acceptance criterion has three parts: a Given, a When and a Then. The Given and the Then are required; the When is left empty for a state that holds with no event.",
      "A criterion uses the words of what the module is about and names nothing of the product's technology.",
      "A criterion references the requirements it decides, at least one.",
      "A requirement is covered when its criteria decide each case it distinguishes, each refusal it states included.",
    ]),
  },
];
