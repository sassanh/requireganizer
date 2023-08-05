export const GENERATE_PRODUCT_OVERVIEW_ENDPOINT =
  "/api/ai/generate-product-overview";
export const GENERATE_STRUCTURAL_FRAGMENT_ENDPOINT =
  "/api/ai/generate-structural-fragment";
export const HANDLE_COMMENT_ENDPOINT = "/api/ai/handle-comment";

export { type RequestBody, type ResponseBody } from "./lib";
export { type GenerateStructuralFragmentRequestBody } from "./generate-structural-fragment/route";
export { type HandleCommentRequestBody } from "./handle-comment/route";
