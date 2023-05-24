import { SnapshotIn } from "mobx-state-tree";
import { ChatCompletionRequestMessage, Configuration, OpenAIApi } from "openai";

import { StructuralFragment } from "@/store/models";

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});

export const ai = new OpenAIApi(configuration);

export const generatePrompt = (
  subject: string
): ChatCompletionRequestMessage[] => [
    {
      role: "user",
      content: `Please generate ${subject} for the software as described in the provided material.`,
    },
    {
      role: "user",
      content:
        "Don't prefix items with numbers, bullet points or dashes except the 5 hats.",
    },
    {
      role: "user",
      content: `Do not include any other titles or headings like 'Test Scenarios:' or 'Requirements:', and just provide the ${subject}.`,
    },
    {
      role: "user",
      content: 'Each item should start with 5 hats like this "^^^^^".',
    },
  ];

export const systemPrompt = `This is an application that starts with a description of a piece of software, and runs minor iterations on it with the help of you to complete a major iteration of the software development. A major iteration is supposed to consist these minor iterations:
1. Generate product overview based on the description.
2. Generate user stories based the product overview.
3. Generate requirements based on the user stories.
4. Generate acceptance criteria based on the requirements.
5. Generate test scenarios based on the acceptance criteria.
6. Generate test cases based on the test scenarios.
7. Generate test code based on test scenarios.
8. Generate code to satisfy tests.
9. Run retrospective to understand the concerns of the user in the process.
10. Help the user to update the specification and run the major iteration again.`;

export const prepareContent = (
  content: string,
  separator: string = "^^^^^"
): SnapshotIn<StructuralFragment>[] =>
  content
    .split(separator)
    .slice(1)
    .map((item) => ({
      content: item.trim(),
    })) || [];
