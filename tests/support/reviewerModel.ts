/**
 * Configure a reviewer model for the importing test file. Import it before
 * any app module: the configuration is read once, when the model module loads.
 */
process.env.NEXT_PUBLIC_AI_REVIEWER_MODEL = "reviewer-model";

export {};
