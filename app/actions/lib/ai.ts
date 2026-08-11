import { GoogleGenAI } from "@google/genai";

export const MODEL_FUNCTION_CALLING = "gemini-3-flash-preview";
export const MODEL_TEXT = "gemini-2.5-flash";

let client: GoogleGenAI | null = null;

export function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY environment variable is not set. Add it to your environment to use AI features.",
    );
  }
  if (client == null) {
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

export function stripMarkdownFences(
  text: string,
  language = "(?:json|jsonc|javascript)?",
): string {
  return text
    .replace(new RegExp(`^\`\`\`${language}\\n?`, "i"), "")
    .replace(/\n?```$/i, "")
    .trim();
}
