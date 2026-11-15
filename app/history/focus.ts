import { isRecord } from "lib/json";

/** Where the spec owner's focus is: a unit of a module's stage, or, with no unit, the stage itself. */
export interface FocusPlace {
  moduleId: string;
  stage: string;
  unitId: string | null;
}

export function isFocusPlace(value: unknown): value is FocusPlace {
  return (
    isRecord(value) &&
    typeof value.moduleId === "string" &&
    typeof value.stage === "string" &&
    (value.unitId === null || typeof value.unitId === "string")
  );
}

export function sameFocusPlace(left: FocusPlace | null, right: FocusPlace | null): boolean {
  return left === right || (left != null && right != null && left.moduleId === right.moduleId && left.stage === right.stage && left.unitId === right.unitId);
}
