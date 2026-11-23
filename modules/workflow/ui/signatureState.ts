import type { StageSummary } from "../module";

/**
 * Which of three a unit or a named item is: approved, signable, or neither.
 * The page shows it as a bar on a card's left edge and as a chip's colour:
 * green once approved, orange while signable, and a neutral grey otherwise.
 */
export type SignatureState = "approved" | "signable" | "not-signable";

/** The palette each state shows in. One that is neither keeps the theme's neutral grey. */
export const SIGNATURE_STATE_PALETTE = {
  approved: "success",
  signable: "warning",
  "not-signable": "default",
} as const;

/** The variant a chip shows a state in: approved and signable are filled, while one that is neither stays a normal outlined chip. */
export const SIGNATURE_STATE_CHIP_VARIANT = {
  approved: "filled",
  signable: "filled",
  "not-signable": "outlined",
} as const;

/** The left edge a card shows its state in: a neutral grey that stands out from the card's border for one that is neither. */
export const SIGNATURE_STATE_EDGE = {
  approved: "success.main",
  signable: "warning.main",
  "not-signable": "text.disabled",
} as const;

/** The state of a unit or a named item, from whether it is approved and whether it is signable. */
export function signatureStateOf(approved: boolean, signable: boolean): SignatureState {
  return approved ? "approved" : signable ? "signable" : "not-signable";
}

/** A stage's state: approved once complete, signable while it holds anything signable, and neither otherwise, an empty stage included. */
export function stageSignatureState(summary: StageSummary): SignatureState {
  if (summary.progress === "complete") return "approved";
  return Object.values(summary.signable).some((count) => count > 0) ? "signable" : "not-signable";
}
