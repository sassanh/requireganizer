import { notify } from "components/notices";
import { getUserFacingErrorMessage } from "lib/errors";

/** Carry out a call to the host, telling the spec owner why it failed, if it does. */
export function attempt(call: () => Promise<unknown>, fallback: string): void {
  call().catch((error: unknown) => notify(getUserFacingErrorMessage(error, fallback), "error"));
}
