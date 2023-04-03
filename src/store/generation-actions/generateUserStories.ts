import { Store } from "store/store";

import openai from "../api";

import { generatePrompt, prepareContent } from "./utilities";

export async function generateUserStories(self_: unknown): Promise<void> {
  const self = self_ as Store;

  // Generate user stories
  const userStoriesResult = await openai.createChatCompletion({
    model: "gpt-3.5-turbo",
    n: 1,
    temperature: 0,
    messages: [
      { role: "system", content: "You are a helpful assistant." },
      {
        role: "user",
        content: generatePrompt("user stories"),
      },
      {
        role: "user",
        content: 'Each user story should start with "^^^^^ As a"',
      },
      {
        role: "user",
        content: `description: ${self.description}`,
      },
    ],
  });
  const userStories = userStoriesResult.data.choices[0].message?.content;

  self.setUserStories(prepareContent(userStories));
}
