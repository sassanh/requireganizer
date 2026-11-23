import { type FieldDefinition, type StageDefinition, type TextFieldDefinition } from "workflow";

export const MODULE_OVERVIEW = "module-overview";
export const CAPABILITIES = "capabilities";
export const FEATURES_AND_TARGET_USERS = "features-and-target-users";
export const NEEDS = "needs";
export const REQUIREMENTS = "requirements";
export const ACCEPTANCE_CRITERIA = "acceptance-criteria";

export const PURPOSE = "purpose";
export const CAPABILITY = "capability";
export const FEATURE = "feature";
export const TARGET_USER = "target-user";
export const USER_STORY = "user-story";
export const QUALITY_GOAL = "quality-goal";
export const CONSTRAINT = "constraint";
export const REQUIREMENT = "requirement";
export const ACCEPTANCE_CRITERION = "acceptance-criterion";

/** P2 gives way first and P0 last. */
export const PRIORITIES = ["P0", "P1", "P2"] as const;

/** The words a requirement's obligation follows. */
export const SYSTEM_MUST = "The system must";

export const FUNCTIONAL = "functional";
export const QUALITY = "quality";
/** The type of a requirement that keeps the product within a limit set from outside. */
export const CONSTRAINT_TYPE = "constraint";

/** The types of requirement. */
export const REQUIREMENT_TYPES = [FUNCTIONAL, QUALITY, CONSTRAINT_TYPE] as const;

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

/** A rule of capabilities, features and target users. */
const ONE_SENTENCE_DESCRIPTION = "Its description is one sentence.";

/** A rule of requirements and acceptance criteria. */
const LIMITS_AS_VALUES =
  "An item states every limit it sets as a value that can be checked, such as a time or a count, and uses no word whose meaning depends on the reader, such as fast, easy, many or if possible.";

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
        question: "Whom does the module help, and what is different for them once the module exists?",
        rules: [],
        fields: [text("text", "Purpose", "Whom the module helps and what is different for them once it exists.")],
        display: (parts) => parts.text("text"),
      },
    ],
  },
  {
    id: CAPABILITIES,
    label: "Capabilities",
    buildsOn: [MODULE_OVERVIEW],
    kinds: [
      {
        kind: CAPABILITY,
        label: "Capability",
        plural: "Capabilities",
        code: "CAP",
        question: "Which broad ability does the module have without which its purpose could not be fulfilled at all?",
        rules: ["The purpose is covered when the capabilities referencing it give every broad ability it needs.", ONE_SENTENCE_DESCRIPTION],
        fields: [
          text("name", "Name", "A short name for the ability."),
          text("description", "Description", "One sentence describing the ability."),
        ],
        covers: [PURPOSE],
        referencesSingle: [PURPOSE],
        display: (parts) => `${parts.text("name")}: ${parts.text("description")}`,
      },
    ],
  },
  {
    id: FEATURES_AND_TARGET_USERS,
    label: "Features and Target Users",
    buildsOn: [CAPABILITIES],
    kinds: [
      {
        kind: FEATURE,
        label: "Feature",
        plural: "Features",
        code: "FEA",
        question: "Which concrete ability does the module have that delivers part of a capability and can be described without naming another feature?",
        rules: ["A capability is covered when the features belonging to it deliver all of it.", ONE_SENTENCE_DESCRIPTION],
        fields: [
          text("name", "Name", "A short name for the ability."),
          text("description", "Description", "One sentence describing the ability."),
          {
            name: "capability",
            label: "Capability",
            description: "The one capability the feature belongs to, chosen from the module's capabilities.",
            type: "items",
            of: CAPABILITY,
            shows: "name",
            single: true,
            required: true,
          },
        ],
        covers: [CAPABILITY],
        display: (parts) => `${parts.text("name")}: ${parts.text("description")}`,
      },
      {
        kind: TARGET_USER,
        label: "Target user",
        plural: "Target users",
        code: "USR",
        question: "Which kind of person or role does the module change something for?",
        rules: [ONE_SENTENCE_DESCRIPTION],
        fields: [
          text("name", "Name", 'The kind of person or role, as a user story names it after "As a".'),
          text("description", "Description", "One sentence describing that kind of person or role."),
        ],
        display: (parts) => `${parts.text("name")}: ${parts.text("description")}`,
      },
    ],
  },
  {
    id: NEEDS,
    label: "Needs",
    buildsOn: [FEATURES_AND_TARGET_USERS],
    kinds: [
      {
        kind: USER_STORY,
        label: "User story",
        plural: "User stories",
        code: "US",
        question: "What outcome does a kind of person want from a feature, and why do they want it?",
        rules: ["A feature is covered when the user stories referencing it give every outcome its users need from it."],
        fields: [
          {
            name: "targetUsers",
            label: "Target users",
            description: "The target users the story is for, chosen from the module's target users.",
            type: "items",
            of: TARGET_USER,
            shows: "name",
            required: true,
          },
          text("outcome", "Outcome", 'What they want, as it follows "I want".'),
          text("reason", "Reason", 'Why they want it, as it follows "so that".'),
          PRIORITY,
        ],
        covers: [FEATURE],
        mustReference: [{ kinds: [FEATURE] }],
        display: (parts) => {
          const names = parts.names("targetUsers");
          const article = /^[aeiou]/i.test(names[0] ?? "") ? "an" : "a";
          return `As ${article} ${names.join(" or ")}, I want ${parts.text("outcome")}, so that ${parts.text("reason")}`;
        },
      },
      {
        kind: QUALITY_GOAL,
        label: "Quality goal",
        plural: "Quality goals",
        code: "QG",
        question: "Which quality, such as speed or reliability, does the module need, and why does it need it?",
        rules: [],
        fields: [
          text("quality", "Quality", 'The quality the module needs, as it comes before "so that".'),
          text("reason", "Reason", 'Why the module needs it, as it follows "so that".'),
          PRIORITY,
        ],
        display: (parts) => `${parts.text("quality")}, so that ${parts.text("reason")}`,
      },
      {
        kind: CONSTRAINT,
        label: "Constraint",
        plural: "Constraints",
        code: "CON",
        question: "Which limit is set on the module from outside the product, one the spec owner cannot lift, and who or what sets it?",
        rules: [],
        fields: [
          text("limit", "Limit", 'The limit imposed on the module, as it comes before "set by".'),
          text("source", "Source", 'Who or what imposes it, such as a law, a standard, a contract or a platform, as it follows "set by".'),
        ],
        mayNotReference: [FEATURE],
        display: (parts) => `${parts.text("limit")}, set by ${parts.text("source")}`,
      },
    ],
  },
  {
    id: REQUIREMENTS,
    label: "Requirements",
    buildsOn: [NEEDS],
    kinds: [
      {
        kind: REQUIREMENT,
        label: "Requirement",
        plural: "Requirements",
        code: "REQ",
        question:
          "What must the product do (a functional requirement), how well must it do it (a quality requirement), or which limit must it stay within (a constraint requirement), so that a user story, quality goal or constraint it references is delivered, stated as one obligation that can be checked on its own?",
        rules: [
          "A rationale says why the requirement asks what it asks, where the items it references do not make that plain.",
          "A user story is covered when the requirements referencing it ask for all the behaviour its outcome needs.",
          "A quality goal is covered when the requirements referencing it give, for each situation in which the module needs the quality, a response the product must meet with a limit that can be checked.",
          "A constraint is covered when the requirements referencing it keep the product within its limit wherever the limit applies.",
          LIMITS_AS_VALUES,
        ],
        fields: [
          { ...text("obligation", "Obligation", `What follows "${SYSTEM_MUST}", without those words.`), prefix: SYSTEM_MUST },
          {
            name: "type",
            label: "Type",
            description: "functional: what the product must do; quality: how well it must do it; constraint: which limit set from outside it must stay within.",
            type: "choice",
            options: REQUIREMENT_TYPES,
            initial: FUNCTIONAL,
            cued: true,
            required: true,
          },
          text("rationale", "Rationale", "Why the requirement asks what it asks, where the items it references do not make that plain; may be left empty.", false),
          PRIORITY,
        ],
        covers: [USER_STORY, QUALITY_GOAL, CONSTRAINT],
        mustReference: [{ kinds: [USER_STORY, QUALITY_GOAL, CONSTRAINT] }, { kinds: [CONSTRAINT], when: { field: "type", is: CONSTRAINT_TYPE } }],
        display: (parts) => [parts.text("obligation"), ...(parts.text("rationale") === "" ? [] : [`Rationale: ${parts.text("rationale")}`])].join("\n"),
      },
    ],
  },
  {
    id: ACCEPTANCE_CRITERIA,
    label: "Acceptance Criteria",
    buildsOn: [REQUIREMENTS],
    kinds: [
      {
        kind: ACCEPTANCE_CRITERION,
        label: "Acceptance criterion",
        plural: "Acceptance criteria",
        code: "AC",
        question:
          "Which situation, which event if there is one, and which outcome show that a requirement is met in one case the requirement distinguishes, described so that it holds for every value in that case?",
        rules: [
          "An acceptance criterion uses the words of what the module is about.",
          "A requirement is covered when its criteria decide each case it distinguishes, each refusal it states included.",
          LIMITS_AS_VALUES,
        ],
        fields: [
          text("given", "Given", "The starting situation."),
          text("when", "When", "The event, if there is one; left empty for a state that holds with no event.", false),
          text("then", "Then", "The outcome anyone can check."),
        ],
        covers: [REQUIREMENT],
        mustReference: [{ kinds: [REQUIREMENT] }],
        display: (parts) => [`Given ${parts.text("given")}`, ...(parts.text("when") === "" ? [] : [`When ${parts.text("when")}`]), `Then ${parts.text("then")}`].join("\n"),
      },
    ],
  },
];
