import { SnapshotIn } from "mobx-state-tree";
import { StructuralFragment } from "store/models";

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
