import { toGenerator } from "mobx-state-tree";

import { generateScaffold } from "actions/ai/generate-scaffold";
import { Step } from "store";

import { generator } from "./utilities";

function stripJsoncComments(jsonc: string): string {
    return jsonc
        .replace(/\/\/.*$/gm, "")
        .replace(/\/\*[\s\S]*?\*\//g, "");
}

export default generator(
    function* (self) {
        if (!self.projectConfig) {
            throw new Error("Project config is required before generating scaffold");
        }

        const configString = stripJsoncComments(self.projectConfig);
        const config = JSON.parse(configString);

        // Remove outputPath since we no longer use it, so its placeholders don't block scaffolding
        delete config.outputPath;

        if (JSON.stringify(config).includes("<")) {
            self.systemMessage =
                "Please fill in all <placeholder> values in the project configuration before generating the scaffold.";
            return;
        }

        self.clearMessage();

        // Store the cleaned config (no comments) back
        self.projectConfig = JSON.stringify(config, null, 2);

        const { files } = yield* toGenerator(
            generateScaffold({
                config,
                state: self.json(Step.TestCases),
            }),
        );

        if (files.length === 0) {
            self.systemMessage =
                "Failed to generate scaffold files. Please try again.";
            return;
        }

        // Instead of writing to disk, store in the virtual filesystem
        self.setScaffoldFiles(files);

        self.projectConfigLocked = true;
        self.systemMessage = `Scaffold generated successfully in the virtual filesystem.`;
    },
    { requirements: ["description", "projectConfig"] },
);
