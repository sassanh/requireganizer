import { IStateTreeNode, SnapshotIn } from "mobx-state-tree";
import { StructuralFragment } from "store/models";
import { Tail } from "utilities";

export const generatePrompt = (subject: string) =>
  `Generate the ${subject} for the software as provided in description, do not write anything other than the ${subject}. Just write the result. Don't prefix items with numbers, bullet points or dashes, just pure English sentences/paragraphs, each item should start with 5 hats like this "^^^^^"`;

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
  content: string | undefined
): SnapshotIn<StructuralFragment>[] =>
  content
    ?.split("^^^^^")
    .slice(1)
    .map((item) => ({
      content: item.trim(),
    })) || [];

export const systemPrompt = `This is Requireganizer, an application that starts with a description of a piece of software, and runs minor iterations on it with the help of you to complete a major iteration of the software development. A major iteration is supposed to consist these minor iterations:
1. Generate product overview based on the description.
2. Generate user stories based the product overview.
3. Generate requirements based on the user stories.
4. Generate acceptance criteria based on the requirements.
5. Generate test scenarios and test cases based on acceptance criteria.
6. Generate test code based on test scenarios.
7. Generate code to satisfy tests.
8. Run retrospective to understand the concerns of the user in the process.
9. Help the user to update the specification and run the major iteration again.

In each iteration all the generated material from previous minor and major iterations will be provided to you.
If you see any inconsistency with the previous material, you should mention it.

Note that since your responses are going to be read and processed by machine, you should avoid generating anything other than the response you were explicitly asked to generate. So anything like adding titles, bullet points, talking with the user, etc should be avoided.`;
