export enum ManipulationFunction {
  Initialize = "initialize",
  UpdateList = "updateList",
  Communicate = "communicate",
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
