import { flow } from "mobx-state-tree";
import ai from "store/api";
import { Store } from "store/store";
import { Iteration } from "store/utilities";

import { generator, systemPrompt } from "./utilities";

const generateProductOverview = flow(function* (self_: unknown) {
  const self = self_ as Store;

  self.resetValidationErrors();

  self.productOverview = null;
  const description = self.description;

  // Send the software description to ChatGPT to validate it
  const result = yield ai.createChatCompletion({
    model: "gpt-3.5-turbo",
    n: 1,
    temperature: 0,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: systemPrompt },
      {
        role: "user",
        content: `Create a product overview based on the given software description and only based on the given software description, or, signal if there are any inconsistencies, missing information, or errors. If the description is not valid or has any issues, start the response with "[ERROR]" and provide a brief explanation of the issue(s) found. If the description is valid, generate a product overview highlighting its primary features, target users, and benefits without including any meta conversation or extra information. It is important to avoid guessing the intention of the description and stick with and stay royal its original information and content.`,
      },
      {
        role: "user",
        content: description,
        name: "DescriptionReader",
      },
    ],
  });

  // Handle the validation errors if there are any
  const validationResultContent =
    result.data.choices[0].message?.content.trim() ??
    "[ERROR] Validation failed!";

  if (validationResultContent.startsWith("[ERROR]")) {
    self.setValidationErrors(
      validationResultContent.replace(/^\[ERROR\]/, "").trim()
    );
    return;
  }

  self.productOverview = validationResultContent;
  self.eventTarget.emit("iterationUpdate", Iteration.productOverview);
}) as (self_: unknown) => Promise<void>;

export default generator(generateProductOverview);
