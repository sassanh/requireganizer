import type { FieldDefinition, StageDefinition, TextFieldDefinition } from "workflow";

export const MODULE_OVERVIEW = "module-overview";
export const CAPABILITIES = "capabilities";
export const FEATURES_AND_TARGET_USERS = "features-and-target-users";
export const USER_STORIES = "user-stories";
export const REQUIREMENTS = "requirements";
export const ACCEPTANCE_CRITERIA = "acceptance-criteria";

export const PURPOSE = "purpose";
export const CAPABILITY = "capability";
export const FEATURE = "feature";
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
    ],
    rules: [
      "The purpose states whom the module helps and what changes for them. What is not for that purpose belongs to another module.",
      "The purpose names no technology, architecture or way of building the product.",
    ],
    examples: [
      {
        good: true,
        label: "Good, a purpose",
        text: "People who decide what a product must do get their intent written as requirements, each traced back to a user's need and given the conditions that show whether it is met.",
      },
      {
        good: false,
        label: "Not a purpose, a capability",
        text: "Lets the spec owner sign the spec item by item.",
      },
      {
        good: false,
        label: "Not a purpose, a choice of technology",
        text: "Stores the spec in a relational database and serves it over a socket.",
      },
    ],
  },
  {
    id: CAPABILITIES,
    label: "Capabilities",
    buildsOn: [{ stage: MODULE_OVERVIEW, covers: [PURPOSE] }],
    kinds: [
      {
        kind: CAPABILITY,
        label: "Capability",
        plural: "Capabilities",
        code: "CAP",
        fields: [
          text("name", "Name", "A short name for the ability, such as Signing."),
          text("description", "Description", "One sentence describing one broad ability through which the module fulfils its purpose."),
        ],
        referencesSingle: [PURPOSE],
        display: (parts) => `${parts.text("name")}: ${parts.text("description")}`,
      },
    ],
    rules: [
      "A capability has a name and a description of one broad ability through which the module fulfils its purpose. Its description is one sentence.",
      "If the module lost a capability, it would be for something else. An ability the module could lose and keep its purpose is a feature.",
      "Capabilities do not overlap: two that cannot be told apart in one sentence are one.",
      "A guarantee every sound product gives, such as being correct or safe, is a requirement, not a capability.",
      "Capabilities name no technology, architecture or way of building the product.",
      "Each capability counts as referencing the purpose, without listing it. The purpose is covered when the capabilities referencing it give every broad ability it needs.",
    ],
    examples: [
      {
        good: true,
        label: "Good, a capability",
        text: "Signing: The spec owner signs each item, coverage and change, so that only what they approved counts as decided.",
      },
      {
        good: false,
        label: "Not a capability, a feature",
        text: "Rules dialog: Shows a stage's published rules beside its items.",
      },
      {
        good: false,
        label: "Not a capability, a rule rather than an ability",
        text: "Refused writes: A refused write leaves the spec unchanged.",
      },
    ],
  },
  {
    id: FEATURES_AND_TARGET_USERS,
    label: "Features and Target Users",
    buildsOn: [{ stage: CAPABILITIES, covers: [CAPABILITY] }],
    kinds: [
      {
        kind: FEATURE,
        label: "Feature",
        plural: "Features",
        code: "FEA",
        fields: [
          text("name", "Name", "A short name for the ability, such as Rules dialog."),
          text("description", "Description", "One sentence describing one concrete ability through which its capability is delivered."),
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
        display: (parts) => `${parts.text("name")}: ${parts.text("description")}`,
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
    rules: [
      "A feature has a name, a description of one concrete ability through which a capability is delivered, and the one capability it belongs to.",
      "If the module lost a feature, its capability would no longer be fully delivered. Variations, options, checks, error cases and single rules belong to the feature they refine, as user stories or requirements, never as features beside it.",
      "Features name no technology, architecture or way of building the product.",
      'A target user has a name, the kind of person or role user stories name after "As a", and a description of it. It is a kind of person or role the module changes something for, not a named individual, a team or a system.',
      "Each description of a feature or a target user is one sentence.",
      "A capability is covered when the features belonging to it deliver all of it.",
    ],
    examples: [
      {
        good: true,
        label: "Good, a feature",
        text: "Rules dialog: Shows a stage's published rules beside its items.",
      },
      {
        good: false,
        label: "Not a feature, a capability",
        text: "Signing: The spec owner signs each item, coverage and change, so that only what they approved counts as decided.",
      },
      {
        good: false,
        label: "Not a feature, a single check",
        text: "Empty purpose: Refuses a purpose that has no text.",
      },
      {
        good: true,
        label: "Good, a target user",
        text: "spec owner: A person who owns what a product must do and signs its spec.",
      },
      {
        good: false,
        label: "Not a target user, a named person",
        text: "Ada: The founder who asked for the module.",
      },
    ],
  },
  {
    id: USER_STORIES,
    label: "User Stories",
    buildsOn: [{ stage: FEATURES_AND_TARGET_USERS, covers: [FEATURE] }],
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
        mustReference: [FEATURE],
        display: (parts) => {
          const names = parts.names("targetUsers");
          const article = /^[aeiou]/i.test(names[0] ?? "") ? "an" : "a";
          return `As ${article} ${names.join(" or ")}, I want ${parts.text("outcome")}, so that ${parts.text("reason")}`;
        },
      },
    ],
    rules: [
      'A user story has three parts, all required: the target users it is for, chosen from the module\'s target users (usually one), the outcome they want, and the reason they want it. It reads "As a <target user>, I want <outcome>, so that <reason>", several target users joined with "or".',
      "A user story references the features it serves, at least one. It counts as referencing each of its target users, so its references do not list them again.",
      "A feature is covered when the stories referencing it give every outcome its users need from it.",
      "A priority, P0, P1 or P2, says what gives way first when not everything can be delivered: P2 gives way first, P0 last.",
    ],
    examples: [
      {
        good: true,
        label: "Good, a user story",
        text: "As a spec owner, I want each user story to reference the feature it serves, so that I can check each feature for outcomes no story gives yet.",
      },
      {
        good: false,
        label: "Not a user story, a requirement",
        text: "The system must refuse to save a user story that references no feature.",
      },
      {
        good: false,
        label: "Not a user story, the reason restates the outcome",
        text: "As a spec owner, I want to write a user story, so that I write a user story.",
      },
    ],
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
        display: (parts) => parts.text("obligation"),
      },
    ],
    rules: [
      'A requirement holds the obligation that follows "The system must" and reads with those words in front.',
      "A requirement states one obligation that can be verified on its own and chooses nothing of how the product is built.",
      "A requirement references the user stories it delivers, at least one.",
      "A user story is covered when the requirements referencing it ask for all the behaviour its outcome needs.",
      "A priority, P0, P1 or P2, says what gives way first when not everything can be delivered: P2 gives way first, P0 last.",
    ],
    examples: [
      {
        good: true,
        label: "Good, a requirement",
        text: "The system must refuse to save a user story that references no feature of its module.",
      },
      {
        good: false,
        label: "Not a requirement, two obligations",
        text: "The system must hold user stories and notify the spec owner when one changes.",
      },
      {
        good: false,
        label: "Not a requirement, a choice of technology",
        text: "The system must store each user story in a PostgreSQL table.",
      },
    ],
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
    rules: [
      "An acceptance criterion has three parts: a Given, a When and a Then. The Given and the Then are required; the When is left empty for a state that holds with no event.",
      "A criterion uses the words of what the module is about and names nothing of the product's technology.",
      "A criterion references the requirements it decides, at least one.",
      "A requirement is covered when its criteria decide each case it distinguishes, each refusal it states included.",
    ],
    examples: [
      {
        good: true,
        label: "Good, an acceptance criterion",
        text: "Given a user story that references no feature, When the spec owner saves it, Then the system refuses it and names the missing feature.",
      },
      {
        good: false,
        label: "Not an acceptance criterion, a requirement",
        text: "The system must refuse a story that references no feature.",
      },
      {
        good: false,
        label: "Not an acceptance criterion, a choice of technology",
        text: "Given a PostgreSQL table, When a row is inserted, Then the row is stored.",
      },
    ],
  },
];
