import { IStateTreeNode, SnapshotIn } from "mobx-state-tree";
import { StructuralFragment } from "store/models";
import { Tail } from "utilities";

export const generatePrompt = (subject: string) =>
  `Generate the ${subject} for the software as provided in description. Don't prefix items with numbers, bullet points or dashes except the 5 hats. Each item should start with 5 hats like this "^^^^^"`;

export const generator = <
  Generator extends (
    store: IStateTreeNode & { isGenerating: boolean },
    ...args: any[]
  ) => void | Promise<void>
>(
  function_: Generator
) => {
  return (
    store: IStateTreeNode & { isGenerating: boolean },
    ...args: Tail<Parameters<Generator>>
  ): void | Promise<void> => {
    if (store.isGenerating) {
      return;
    }

    try {
      store.isGenerating = true;

      return function_(store, ...args);
    } catch (error) {
      console.error(`Error while generating (${function_.name}):`, error);
      alert(error);
    } finally {
      store.isGenerating = false;
    }
  };
};

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

export const systemPrompt = `This is Requireganizer, an application that starts with a description of a piece of software, and runs minor iterations on it with the help of you to complete a major iteration of the software development. A major iteration is supposed to consist these minor iterations:
1. Generate product overview based on the description.
2. Generate user stories based the product overview.
3. Generate requirements based on the user stories.
4. Generate acceptance criteria based on the requirements.
5. Generate test scenarios based on the acceptance criteria.
6. Generate test cases based on the test scenarios.
7. Generate test code based on test scenarios.
8. Generate code to satisfy tests.
9. Run retrospective to understand the concerns of the user in the process.
10. Help the user to update the specification and run the major iteration again.

In each iteration all the generated material from previous minor and major iterations will be provided to you.
If you see any inconsistency with the previous material, you should mention it.

Do not include any titles, labels, headings or bullet points like 'Test Scenarios:' or 'Requirements:' or '1.' or 'Here are the test scenarios for you:'.`;
