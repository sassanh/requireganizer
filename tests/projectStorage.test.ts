import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ProjectKeyValueStorage,
  ProjectStorageError,
  getProjectStorageKey,
  parseProjectsIndex,
  readStoredProjectView,
  saveProjectBundleToStorage,
} from "../app/lib/projectStorage";

class MemoryStorage implements ProjectKeyValueStorage {
  readonly values = new Map<string, string>();
  failNextSetFor: string | null = null;

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failNextSetFor === key) {
      this.failNextSetFor = null;
      throw new Error(`Failed to write ${key}.`);
    }
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe("project storage parsing", () => {
  it("filters malformed and duplicate project metadata", () => {
    const projects = parseProjectsIndex(
      JSON.stringify([
        {
          id: "valid",
          name: "Project",
          description: "Description",
          updatedAt: "2026-08-11T00:00:00.000Z",
        },
        {
          id: "valid",
          name: "Duplicate",
          description: "",
          updatedAt: "2026-08-11T00:00:00.000Z",
        },
        { id: "invalid", name: "Missing fields" },
      ]),
    );

    assert.equal(projects.length, 1);
    assert.equal(projects[0].name, "Project");
  });

  it("returns an empty index for corrupted JSON", () => {
    assert.deepEqual(parseProjectsIndex("not json"), []);
  });

  it("extracts a safe code-view model", () => {
    assert.deepEqual(
      readStoredProjectView({
        productOverview: { name: "Example" },
        scaffoldFiles: [{ path: "src/index.ts", content: "export {};" }],
      }),
      {
        name: "Example",
        scaffoldFiles: [{ path: "src/index.ts", content: "export {};" }],
      },
    );
  });

  it("does not expose unsafe persisted scaffold paths", () => {
    assert.deepEqual(
      readStoredProjectView({
        productOverview: { name: "Example" },
        scaffoldFiles: [{ path: "../outside", content: "secret" }],
      }),
      { name: "Example", scaffoldFiles: [] },
    );
  });

  it("rolls back both records when an imported-project transaction fails", () => {
    const storage = new MemoryStorage();
    const projectKey = getProjectStorageKey("project-1");
    const indexKey = "requireganizer:projects";
    storage.setItem(projectKey, '{"old":true}');
    storage.setItem(indexKey, '[{"old":true}]');
    storage.failNextSetFor = indexKey;

    assert.throws(
      () =>
        saveProjectBundleToStorage(
          storage,
          "project-1",
          { replacement: true },
          [
            {
              id: "project-1",
              name: "Project",
              description: "Description",
              updatedAt: "2026-08-11T00:00:00.000Z",
            },
          ],
        ),
      (error: unknown) => error instanceof ProjectStorageError,
    );
    assert.equal(storage.getItem(projectKey), '{"old":true}');
    assert.equal(storage.getItem(indexKey), '[{"old":true}]');
  });
});
