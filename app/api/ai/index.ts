export const GENERATE_ACCEPTANCE_CRITERIA_ENDPOINT =
  "/api/ai/generate-acceptance-criteria";
export const GENERATE_PRODUCT_OVERVIEW_ENDPOINT =
  "/api/ai/generate-product-overview";
export const GENERATE_REQUIREMENTS_ENDPOINT = "/api/ai/generate-requirements";
export const GENERATE_TEST_CASES_ENDPOINT = "/api/ai/generate-test-cases";
export const GENERATE_TEST_SCENARIOS_ENDPOINT =
  "/api/ai/generate-test-scenarios";
export const GENERATE_USER_STORIES_ENDPOINT = "/api/ai/generate-user-stories";
export const HANDLE_COMMENT_ENDPOINT = "/api/ai/handle-comment";

export { type RequestBody, type ResponseBody } from "./lib";
export { type GenerateTestCasesRequestBody } from "./generate-test-cases/route";
export { type HandleCommentRequestBody } from "./handle-comment/route";
