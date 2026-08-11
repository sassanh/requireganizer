import type { ArtifactProposalItem } from "ai-harness/contracts";

export type PersistedArtifactItem = Omit<
  ArtifactProposalItem,
  "key" | "id"
> & {
  id: string;
};

export function materializeArtifactItems(
  items: ArtifactProposalItem[],
  createId: () => string,
): PersistedArtifactItem[] {
  const idByKey = new Map<string, string>();

  for (const item of items) {
    if (idByKey.has(item.key)) {
      throw new Error(`Cannot materialize duplicate proposal key ${item.key}.`);
    }
    idByKey.set(item.key, item.id ?? createId());
  }

  return items.map(({ key, dependencies, ...item }) => {
    const id = idByKey.get(key);
    if (id == null) {
      throw new Error(`Cannot resolve proposal key ${key}.`);
    }

    return {
      ...item,
      id,
      dependencies: dependencies.map((dependencyKey) => {
        const dependencyId = idByKey.get(dependencyKey);
        if (dependencyId == null) {
          throw new Error(`Cannot resolve dependency key ${dependencyKey}.`);
        }
        return dependencyId;
      }),
    };
  });
}
