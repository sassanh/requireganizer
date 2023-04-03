import { IStateTreeNode, SnapshotIn } from "mobx-state-tree";
import { StructuralFragment } from "store/models";
import { Tail } from "utilities";

export const generatePrompt = (subject: string) =>
  `Generate the ${subject} for the software as provided in description, do not write anything other than the ${subject}. Just write the result. Don't prefix items with numbers, bullet points or dashes, just pure English sentences/paragraphs, each item should start with 5 hats like this "^^^^^"`;

export const prepareContent = (
  content: string | undefined
): SnapshotIn<StructuralFragment>[] =>
  content
    ?.split("^^^^^")
    .slice(1)
    .map((item) => ({
      content: item.trim(),
    })) || [];

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
