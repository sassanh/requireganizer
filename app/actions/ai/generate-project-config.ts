"use server";
import "server-only";

import { ActionParameters } from "lib/types";

export async function generateProjectConfig({
    state,
}: ActionParameters): Promise<{ config: string }> {
    const { GoogleGenAI } = await import("@google/genai");
    const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

    const parsed = JSON.parse(state);

    const result = await client.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
            {
                role: "user",
                parts: [
                    {
                        text: `Based on the following project information, generate a project configuration as a JSONC (JSON with // comments) object.

Project: ${parsed.productOverview?.name || "Unnamed"}
Framework: ${parsed.productOverview?.framework || "Unknown"}
Language: ${parsed.productOverview?.programmingLanguage || "Unknown"}
Purpose: ${parsed.productOverview?.purpose || "Unknown"}

Generate a JSONC configuration object that includes all parameters needed to set up the testing framework and relevant project settings.

Rules:
- For fields with known sane defaults, fill them in directly and add a comment explaining alternatives
- Always include these fields: testFramework, packageManager
- OMIT any fields related to output paths, directory paths, or file locations. The filesystem is virtual.
- Include any framework-specific configuration fields relevant to the chosen framework and language
- Add // comments explaining each field and available options
- The output must be valid JSONC (JSON with // single-line comments)
- Do NOT wrap in markdown code fences
- Output ONLY the raw JSONC content, nothing else`,
                    },
                ],
            },
        ],
    });

    const config = result.text?.trim() ?? "";
    // Strip markdown fences if the model added them
    const cleaned = config
        .replace(/^```(?:jsonc?|javascript)?\n?/i, "")
        .replace(/\n?```$/i, "")
        .trim();

    return { config: cleaned };
}
