export const BOUNDARY = "boundary";
export const ABSTRACT_TESTS = "abstract-tests";

export const BOUNDARY_STATEMENT = "boundary-statement";
export const ENTITY_TYPE = "entity-type";
export const WORD_SET = "word-set";
export const OPERATION = "operation";
export const ABSTRACT_TEST = "abstract-test";

export const DIRECT_SETUP = "direct setup";
export const ACTION = "action";
export const OBSERVATION = "observation";

/** The kinds of operation, each exactly one operation's. */
export const OPERATION_KINDS = [DIRECT_SETUP, ACTION, OBSERVATION] as const;

export type OperationKind = (typeof OPERATION_KINDS)[number];

/** The sections of an abstract test that hold steps calling an operation. */
export const GIVEN = "given";
export const WHEN = "when";
export const THEN = "then";

/** What a Then step expects. */
export const EXPECTATIONS = ["observation", "result", "duration", "refusal"] as const;

export type Expectation = (typeof EXPECTATIONS)[number];
