import { Instance, cast, types } from "mobx-state-tree";

import {
  fingerprint,
  renderTestCaseExpectedResult,
  renderTestCaseSteps,
  type TestCaseDefinition,
} from "contract-domain";
import { StructuralFragment } from "store/constants";
import { uuid } from "utilities";

import {
  StructuralFragmentModel,
  StructuralFragmentUpdate,
  dependenciesEqual,
  referencesEqual,
} from "./StructuralFragment";

interface TestCaseUpdate extends StructuralFragmentUpdate {
  title?: string;
  description?: string;
  definition?: TestCaseDefinition;
  revisionId?: string;
  revision?: number;
}

export type TestCase = Instance<typeof TestCaseModel>;

export const TestCaseModel = types
  .compose(
    StructuralFragmentModel,
    types.model({
      type: types.optional(
        types.literal(StructuralFragment.TestCase),
        StructuralFragment.TestCase,
      ),
      title: types.optional(types.string, "New Test Case"),
      description: types.optional(types.string, ""),
      definition: types.maybeNull(types.frozen<TestCaseDefinition>()),
      revisionId: types.optional(types.string, uuid),
      revision: types.optional(types.number, 1),
      generatedInputFingerprint: types.maybeNull(types.string),
    }),
  )
  .views((self) => ({
    get steps() {
      return self.definition == null ? "" : renderTestCaseSteps(self.definition);
    },
    get expectedResult() {
      return self.definition == null
        ? ""
        : renderTestCaseExpectedResult(self.definition);
    },
    get inputFingerprint() {
      return self.definition == null
        ? null
        : fingerprint({
            revisionId: self.revisionId,
            definition: self.definition,
          });
    },
  }))
  .views((self) => ({
    get testStatus(): "not-generated" | "generated" | "out-of-sync" {
      if (self.inputFingerprint == null || self.generatedInputFingerprint == null) {
        return "not-generated";
      }
      return self.inputFingerprint === self.generatedInputFingerprint
        ? "generated"
        : "out-of-sync";
    },
  }))
  .actions((self) => ({
    setTitle(title: string) {
      self.title = title;
      self.revision += 1;
      self.revisionId = uuid();
    },
    setDescription(description: string) {
      self.description = description;
      self.content = description;
      self.revision += 1;
      self.revisionId = uuid();
    },
    setDefinition(definition: TestCaseDefinition) {
      self.definition = cast(definition);
      self.revision += 1;
      self.revisionId = uuid();
    },
    markGenerated(inputFingerprint: string) {
      self.generatedInputFingerprint = inputFingerprint;
    },
    clearGenerated() {
      self.generatedInputFingerprint = null;
    },
    setData(data: TestCaseUpdate) {
      let changed = false;
      if (data.title !== undefined && data.title !== self.title) {
        self.title = data.title;
        changed = true;
      }
      if (data.description !== undefined && data.description !== self.description) {
        self.description = data.description;
        self.content = data.description;
        changed = true;
      }
      if (
        data.definition !== undefined &&
        fingerprint(data.definition) !== fingerprint(self.definition)
      ) {
        self.definition = cast(data.definition);
        changed = true;
      }
      if (data.priority !== undefined && data.priority !== self.priority) {
        self.setPriority(data.priority);
        changed = true;
      }
      if (
        data.references !== undefined &&
        !referencesEqual(data.references, self.references)
      ) {
        self.setReferences(data.references);
        changed = true;
      }
      if (
        data.dependencies !== undefined &&
        !dependenciesEqual(data.dependencies, self.dependencies)
      ) {
        self.setDependencies(data.dependencies);
        changed = true;
      }
      if (data.content !== undefined && data.content !== self.content) {
        self.setContent(data.content);
        self.description = data.content;
        changed = true;
      }
      if (changed) {
        self.revision = data.revision ?? self.revision + 1;
        self.revisionId = data.revisionId ?? uuid();
      }
    },
  }))
  .named("TestCase");
