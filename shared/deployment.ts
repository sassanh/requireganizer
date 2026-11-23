/**
 * Where this build's project host runs, fixed when the app is built: in the
 * page, with browser storage and the user's own AI settings, or in the
 * server that served the page, which the page then only displays.
 */
export const PROJECT_HOST_LOCATION: "page" | "server" =
  process.env.NEXT_PUBLIC_PROJECT_HOST === "server" ? "server" : "page";
