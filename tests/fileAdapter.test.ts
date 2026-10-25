import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";

import { getSnapshot } from "mobx-state-tree";

import { describeModuleRecordsContract, projectMeta } from "./support/persistenceAdapterContract";
import { UserFacingError } from "../app/lib/errors";
import { LEGACY_MODULE_ID } from "../app/lib/moduleSchema";
import { PROJECT_SCHEMA_VERSION } from "../app/lib/projectSchema";
import { type ProjectMeta, ProjectStorageError } from "../app/lib/projectStorage";
import type { OutsideChange } from "../app/persistence";
import { WorkflowStage } from "../app/store/constants";
import { Store } from "../app/store/store";
import { DEFAULT_FILE_PROJECT_ID, FilePersistenceAdapter } from "../server/fileAdapter";

const directories: string[] = [];
after(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

function workspace(): { projectFile: string; stateDirectory: string; adapter: FilePersistenceAdapter } {
  const directory = mkdtempSync(join(tmpdir(), "requireganizer-file-adapter-"));
  directories.push(directory);
  const projectFile = join(directory, "repository", "requireganizer.json");
  const stateDirectory = join(directory, "state");
  return { projectFile, stateDirectory, adapter: new FilePersistenceAdapter({ projectFile, stateDirectory }) };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function registryPayload(name: string): Record<string, unknown> {
  const store = Store.create({ productOverview: {} });
  store.setName({ name });
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    modulesEnabled: false,
    activeModuleId: LEGACY_MODULE_ID,
    modules: [
      {
        id: LEGACY_MODULE_ID,
        name: LEGACY_MODULE_ID,
        archivedAt: null,
        openStep: WorkflowStage.ProductOverview,
        snapshot: getSnapshot(store),
      },
    ],
  };
}

describeModuleRecordsContract(() => workspace().adapter);

describe("file persistence adapter", () => {
  it("describes itself as holding one project, named after its file", () => {
    const { adapter } = workspace();
    assert.deepEqual(adapter.traits, { singleProject: true, name: "requireganizer.json" });
  });

  it("creates the project file, then keeps its name while saves refresh the rest", async () => {
    const { adapter, projectFile } = workspace();
    assert.deepEqual(await adapter.projects.list(), []);
    assert.equal(await adapter.projects.load("project-1"), null);

    const meta = projectMeta("project-1", "Plant Pal");
    await adapter.projects.saveIndex([meta]);
    const identity = ({ updatedAt: _updatedAt, ...rest }: ProjectMeta) => rest;
    assert.deepEqual((await adapter.projects.list()).map(identity), [identity(meta)]);
    assert.equal(await adapter.projects.load("project-1"), null);

    const payload = registryPayload("Plant Pal");
    await adapter.projects.save("project-1", payload, {
      description: "Keeps plants alive.",
      updatedAt: "2026-10-23T10:00:00.000Z",
    });
    assert.deepEqual(await adapter.projects.load("project-1"), JSON.parse(JSON.stringify(payload)));
    const [listed] = await adapter.projects.list();
    assert.deepEqual(identity(listed!), { ...identity(meta), description: "Keeps plants alive." });
    // The update time is the file's own, not a line in it.
    assert.equal(listed!.updatedAt, statSync(projectFile).mtime.toISOString());

    // A person reads and diffs the file: the project's identity comes first,
    // then the export-shaped payload, indented, ending in a newline.
    const source = readFileSync(projectFile, "utf8");
    assert.ok(source.endsWith("}\n"));
    assert.deepEqual(Object.keys(JSON.parse(source)).slice(0, 4), [
      "id",
      "name",
      "description",
      "schemaVersion",
    ]);
    assert.match(source, /^ {2}"name": "Plant Pal",$/m);
  });

  it("leaves the file untouched by a save that changes nothing", async () => {
    const { adapter, projectFile } = workspace();
    await adapter.projects.saveIndex([projectMeta("project-1")]);
    const payload = registryPayload("Plant Pal");
    await adapter.projects.save("project-1", payload, { description: "Same.", updatedAt: "2026-10-23T10:00:00.000Z" });
    const written = statSync(projectFile).mtimeMs;
    await new Promise((resolve) => setTimeout(resolve, 20));
    await adapter.projects.save("project-1", payload, { description: "Same.", updatedAt: "2026-10-24T10:00:00.000Z" });
    assert.equal(statSync(projectFile).mtimeMs, written);
  });

  it("opens an export placed as the project file", async () => {
    const { adapter, projectFile } = workspace();
    const payload = registryPayload("Plant Pal");
    mkdirSync(dirname(projectFile), { recursive: true });
    writeFileSync(projectFile, JSON.stringify(payload));
    const [listed] = await adapter.projects.list();
    assert.equal(listed!.id, DEFAULT_FILE_PROJECT_ID);
    assert.equal(listed!.name, "Plant Pal");
    assert.deepEqual(
      await adapter.projects.load(DEFAULT_FILE_PROJECT_ID),
      JSON.parse(JSON.stringify(payload)),
    );
  });

  it("explains a file it cannot read and never writes over it", async () => {
    const { adapter, projectFile } = workspace();
    await adapter.projects.saveIndex([projectMeta("project-1")]);
    const conflicted = "<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>> branch\n";
    writeFileSync(projectFile, conflicted);

    const [listed] = await adapter.projects.list();
    assert.equal(listed!.id, DEFAULT_FILE_PROJECT_ID);
    await assert.rejects(
      adapter.projects.load(DEFAULT_FILE_PROJECT_ID),
      (error: unknown) =>
        error instanceof UserFacingError &&
        /requireganizer\.json could not be read/.test(error.message) &&
        /Fix the file/.test(error.message),
    );
    await assert.rejects(adapter.projects.save("project-1", registryPayload("x")));
    await assert.rejects(adapter.projects.saveIndex([projectMeta("project-1")]));
    assert.equal(readFileSync(projectFile, "utf8"), conflicted);
    // A server started on the broken file refuses to write it as well.
    const restarted = new FilePersistenceAdapter({ projectFile, stateDirectory: join(projectFile, "..", "..", "state") });
    await assert.rejects(restarted.projects.save("project-1", registryPayload("x")), ProjectStorageError);
    assert.equal(readFileSync(projectFile, "utf8"), conflicted);
  });

  it("lists the project of a file it can neither read nor inspect, as its contract requires", async () => {
    const { projectFile, stateDirectory } = workspace();
    mkdirSync(dirname(projectFile), { recursive: true });
    writeFileSync(projectFile, "{}");
    // Every access to a path through a file fails, as for a file removed between two reads.
    const unreachable = new FilePersistenceAdapter({
      projectFile: join(projectFile, "requireganizer.json"),
      stateDirectory,
      now: () => new Date("2026-10-24T00:00:00.000Z"),
    });
    const [listed] = await unreachable.projects.list();
    assert.equal(listed!.id, DEFAULT_FILE_PROJECT_ID);
    assert.equal(listed!.updatedAt, "2026-10-24T00:00:00.000Z");
  });

  it("refuses to open or overwrite a file whose project is invalid", async () => {
    const { adapter, projectFile } = workspace();
    await adapter.projects.saveIndex([projectMeta("project-1")]);
    const invalid = JSON.stringify({ id: "project-1", name: "x", schemaVersion: PROJECT_SCHEMA_VERSION });
    writeFileSync(projectFile, invalid);
    await assert.rejects(adapter.projects.load("project-1"), /does not hold a valid project/);
    await assert.rejects(adapter.projects.save("project-1", registryPayload("x")));
    assert.equal(readFileSync(projectFile, "utf8"), invalid);
  });

  it("refuses a module snapshot the store rejects, so no blank project replaces it", async () => {
    const { adapter, projectFile } = workspace();
    const payload = registryPayload("Plant Pal");
    const modules = payload.modules as { snapshot: Record<string, unknown> }[];
    modules[0]!.snapshot = { ...modules[0]!.snapshot, productOverview: { name: 42 } };
    mkdirSync(dirname(projectFile), { recursive: true });
    writeFileSync(projectFile, JSON.stringify({ id: "project-1", name: "x", ...payload }));
    await assert.rejects(adapter.projects.load("project-1"), /does not hold a valid project/);
  });

  it("never overwrites changes made outside the server, and opens them after a restart", async () => {
    const { adapter, projectFile, stateDirectory } = workspace();
    await adapter.projects.saveIndex([projectMeta("project-1", "Plant Pal")]);
    await adapter.projects.save("project-1", registryPayload("Plant Pal"));
    await adapter.projects.load("project-1");

    // A checkout brings another version of the file while the server runs.
    const checkedOut = `${JSON.stringify({ id: "project-1", name: "Plant Pal", ...registryPayload("From git") }, null, 2)}\n`;
    writeFileSync(projectFile, checkedOut);
    await assert.rejects(
      adapter.projects.save("project-1", registryPayload("Edited here")),
      (error: unknown) =>
        error instanceof UserFacingError &&
        /changed outside Requireganizer/.test(error.message) &&
        /Choose in Requireganizer which version to keep/.test(error.message),
    );
    assert.equal(readFileSync(projectFile, "utf8"), checkedOut);

    const restarted = new FilePersistenceAdapter({ projectFile, stateDirectory });
    // Opening the project holds it, as the session does.
    assert.equal(restarted.outsideChanges.adoptStored(), true);
    const loaded = await restarted.projects.load("project-1");
    const [module] = (loaded!.modules as { snapshot: { productOverview: { name: string } } }[]);
    assert.equal(module!.snapshot.productOverview.name, "From git");
    await restarted.projects.save("project-1", registryPayload("Edited after restart"));
    assert.match(readFileSync(projectFile, "utf8"), /Edited after restart/);
  });

  it("reports one standing change to the file made outside it, until it is undone or overwritten", async () => {
    const { adapter, projectFile } = workspace();
    await adapter.projects.saveIndex([projectMeta("project-1", "Plant Pal")]);
    await adapter.projects.save("project-1", registryPayload("Plant Pal"));
    const written = readFileSync(projectFile, "utf8");
    const reported: (OutsideChange | null)[] = [];
    const stop = adapter.outsideChanges.watch((change) => reported.push(change));
    const settle = async (count: number) => {
      for (let attempt = 0; attempt < 60 && reported.length < count; attempt += 1) await delay(50);
      // Edits that follow later would still be reported here.
      await delay(300);
    };
    try {
      assert.deepEqual([...reported], [null]);
      const checkedOut = `${JSON.stringify({ id: "project-1", name: "Plant Pal", ...registryPayload("From git") }, null, 2)}\n`;
      writeFileSync(projectFile, checkedOut);
      await settle(2);
      // A second edit of the same kind changes nothing that is reported.
      writeFileSync(projectFile, `${checkedOut}\n`);
      await settle(2);
      assert.deepEqual([...reported], [null, { kind: "changed", problem: null }]);

      writeFileSync(projectFile, "<<<<<<< HEAD\n");
      await settle(3);
      const unreadable = reported[2];
      assert.ok(unreadable?.kind === "changed");
      assert.match(unreadable.problem ?? "", /requireganizer\.json could not be read/);
      // A file that cannot be read is never held, so it is never written over.
      assert.equal(adapter.outsideChanges.adoptStored(), false);
      writeFileSync(projectFile, checkedOut.replace('"id": "project-1"', '"id": "project-2"'));
      await settle(4);
      assert.deepEqual(reported[3], { kind: "changed", problem: "requireganizer.json now holds another project." });
      assert.equal(adapter.outsideChanges.adoptStored(), false);
      rmSync(projectFile);
      await settle(5);
      assert.deepEqual(reported[4], { kind: "removed" });
      // Checked out back to the version it wrote: nothing stands any more.
      writeFileSync(projectFile, written);
      await settle(6);
      assert.equal(reported[5], null);

      writeFileSync(projectFile, checkedOut);
      await settle(7);
      // Another reader, such as a page, loads the changed file: it stays a change.
      await adapter.projects.load("project-1");
      await delay(300);
      assert.equal(reported.length, 7);
      await assert.rejects(adapter.projects.save("project-1", registryPayload("Edited here")), /changed outside/);
      assert.equal(adapter.outsideChanges.adoptStored(), true);
      assert.equal(reported[7], null);
      await adapter.projects.save("project-1", registryPayload("Edited here"));
      assert.match(readFileSync(projectFile, "utf8"), /Edited here/);
      await delay(300);
      assert.equal(reported.length, 8);
    } finally {
      stop();
    }
  });

  it("holds one project: another one, a second import, and deletion are refused", async () => {
    const { adapter, projectFile } = workspace();
    await adapter.projects.saveIndex([projectMeta("project-1")]);
    await adapter.projects.save("project-1", registryPayload("First"));
    const stored = readFileSync(projectFile, "utf8");

    await assert.rejects(
      adapter.projects.saveIndex([projectMeta("project-1"), projectMeta("project-2")]),
      /serves the project in requireganizer\.json only/,
    );
    await assert.rejects(adapter.projects.save("project-2", registryPayload("Second")), ProjectStorageError);
    await assert.rejects(
      adapter.projects.saveBundle("project-1", registryPayload("Second"), [projectMeta("project-1")]),
      /already holds a project/,
    );
    await assert.rejects(adapter.projects.load("project-2"), UserFacingError);
    await assert.rejects(adapter.projects.delete("project-1"), /Delete requireganizer\.json yourself/);
    assert.equal(readFileSync(projectFile, "utf8"), stored);
  });

  it("imports a project into a folder that holds none", async () => {
    const { adapter } = workspace();
    const payload = registryPayload("Imported");
    await adapter.projects.saveBundle("project-1", payload, [projectMeta("project-1", "Imported")]);
    const [listed] = await adapter.projects.list();
    assert.equal(listed!.id, "project-1");
    assert.equal(listed!.name, "Imported");
    assert.deepEqual(await adapter.projects.load("project-1"), JSON.parse(JSON.stringify(payload)));
  });

  it("keeps every id inside its own folder and lists around a damaged revision", async (t) => {
    t.mock.method(console, "error", () => {});
    const { adapter, stateDirectory } = workspace();
    assert.equal(await adapter.timelines.save("..", "..", { version: 1 }), true);
    assert.ok(existsSync(join(stateDirectory, "timelines", "%2E%2E", "%2E%2E.json")));

    const kept = await adapter.revisions.save("project-1", "main", { a: 1 }, "Kept");
    writeFileSync(join(stateDirectory, "revisions", "damaged.json"), "{");
    assert.deepEqual((await adapter.revisions.list("project-1", "main")).map((snapshot) => snapshot.id), [kept.id]);
  });

  it("keeps the project's history in the state directory, not beside the project file", async () => {
    const { adapter, projectFile, stateDirectory } = workspace();
    await adapter.projects.saveIndex([projectMeta("project-1")]);
    await adapter.timelines.save("project-1", LEGACY_MODULE_ID, { version: 1 });
    await adapter.revisions.save("project-1", LEGACY_MODULE_ID, { a: 1 }, "Before");
    assert.ok(existsSync(join(stateDirectory, "timelines")));
    assert.ok(existsSync(join(stateDirectory, "revisions")));
    assert.deepEqual(readdirSync(dirname(projectFile)), ["requireganizer.json"]);
  });
});
