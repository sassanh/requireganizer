import { toGenerator } from "mobx-state-tree";

import { generateProjectConfig } from "actions/ai/generate-project-config";
import { Step } from "store";

import { generator } from "./utilities";

export default generator(
    function* (self) {
        self.resetValidationErrors();
        self.projectConfig = null;
        self.projectConfigLocked = false;

        const { config } = yield* toGenerator(
            generateProjectConfig({
                state: self.json(Step.TestCases),
            }),
        );

        self.projectConfig = config;
        self.isProjectConfigDialogOpen = true;
    },
    { requirements: ["description"] },
);
