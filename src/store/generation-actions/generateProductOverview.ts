import { flow } from "mobx-state-tree";
import { Store } from "store/store";

import openai from "../api";

import { generator, systemPrompt } from "./utilities";

const generateProductOverview = flow(function* (self_: unknown) {
  const self = self_ as Store;

  self.productOverview = null;
  const description = self.description;

  // Send the software description to ChatGPT to validate it
  const validationResult = yield openai.createChatCompletion({
    model: "gpt-3.5-turbo",
    n: 1,
    temperature: 0,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: systemPrompt },
      {
        role: "user",
        content: `Validate the following software description and identify any errors, you should invalidate this description if it is not a software description or has any errors. If there is no errors and it is good, return 5 plus signs like this "+++++" followed by a "product overview" of the application. Otherwise, if there is any errors, return 5 dashes like this "-----" followed by the errors, nothing less, nothing more.`,
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
    validationResult.data.choices[0].message?.content.trim() ??
    "-----Validation failed!";

  if (validationResultContent.startsWith("+++++")) {
    self.resetValidationErrors();
    self.productOverview = validationResultContent
      .replace(/^\+\+\+\+\+/, "")
      .trim();

    return;
  }

  self.setValidationErrors(
    validationResultContent.replace(/^-----/, "").trim()
  );
}) as (self_: unknown) => Promise<void>;

export default generator(generateProductOverview);
