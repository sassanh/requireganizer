export enum ManipulationFunction {
  Initialize = "initialize",
  UpdateList = "updateList",
  Error = "error",
}

export interface FunctionCall {
  name: ManipulationFunction;
  arguments?: string;
}

export interface ActionParameters {
  state: string;
}

export interface ActionReturnValue {
  functionCall: FunctionCall;
}

export enum EntityType {
  UserStory = "user_story",
  Requirement = "requirement",
  AcceptanceCriteria = "acceptance_criteria",
  TestScenario = "test_scenario",
  TestCase = "test_case",
}
