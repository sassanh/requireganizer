"use server";
import "server-only";

import { getGeminiClient, MODEL_TEXT, stripMarkdownFences } from "actions/lib/ai";

export interface ScaffoldFile {
    path: string;
    content: string;
}

export async function generateScaffold({
    config,
    state,
}: {
    config: Record<string, unknown>;
    state: string;
}): Promise<{ files: ScaffoldFile[] }> {
    const client = getGeminiClient();

    const result = await client.models.generateContent({
        model: MODEL_TEXT,
        contents: [
            {
                role: "user",
                parts: [
                    {
                        text: `You are a project scaffolding generator. Based on the following project configuration and state, generate all the boilerplate files needed to set up the project.

Project Configuration:
${JSON.stringify(config, null, 2)}

Project State:
${state}

Generate a JSON array of files to create. Each file should have:
- "path": relative path from the project root (e.g. "package.json", "src/index.ts", "tests/setup.ts")
- "content": the full file content as a string

Include:
1. Package manager config (package.json with all needed dependencies including the test framework)
2. Build/compiler configuration (tsconfig.json, etc.)
3. Test framework configuration
4. Project structure with entry points
5. Test setup/helper files
6. .gitignore
7. README.md with basic project info

Do NOT include:
- Actual test files (those will be generated later)
- Application source code (that will be generated later)
- Lock files

Output ONLY a valid JSON array, no markdown fences, no explanation.
Example format: [{"path": "package.json", "content": "..."}, ...]`,
                    },
                ],
            },
        ],
    });

    const text = result.text?.trim() ?? "[]";
    // Strip markdown fences if present
    const cleaned = stripMarkdownFences(text);

    try {
        const files: ScaffoldFile[] = JSON.parse(cleaned);
        return { files };
    } catch {
        console.error("Failed to parse scaffold response:", cleaned);
        return { files: [] };
    }
}
