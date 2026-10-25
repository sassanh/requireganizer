import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { applySnapshot, getSnapshot } from "mobx-state-tree";

import { linkInProcess } from "../app/connection";
import { LEGACY_MODULE_ID } from "../app/lib/moduleSchema";
import { PROJECT_SCHEMA_VERSION } from "../app/lib/projectSchema";
import { ProjectClient } from "../app/project-client";
import { ProjectHost } from "../app/project-host";
import { ProjectSession } from "../app/project-session";
import { WorkflowStage } from "../app/store/constants";
import { Store } from "../app/store/store";
import { undo } from "../app/store/timeline/controller";
import { FilePersistenceAdapter } from "../server/fileAdapter";

const directories: string[] = [];
after(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(description: string, condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${description}.`);
    await delay(20);
  }
}

/** The project file's contents with the overview named `name`. */
function projectFileNamed(name: string): string {
  const store = Store.create({ productOverview: {} });
  store.setName({ name });
  const payload = {
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
  return `${JSON.stringify({ id: "project-1", name: "Plant Pal", description: "", ...payload }, null, 2)}\n`;
}

/** A project served from its file, as the server serves it. */
async function servedProject() {
  const directory = mkdtempSync(join(tmpdir(), "requireganizer-outside-"));
  directories.push(directory);
  const projectFile = join(directory, "requireganizer.json");
  writeFileSync(projectFile, projectFileNamed("Plant Pal"));
  const adapter = new FilePersistenceAdapter({ projectFile, stateDirectory: join(directory, "state") });
  const session = new ProjectSession(adapter, { outsideChanges: adapter.outsideChanges });
  const host = new ProjectHost(session);
  const client = new ProjectClient(() => linkInProcess(host));
  const disconnect = client.open();
  session.start();
  await waitFor("the project to open", () => session.getSnapshot().status === "ready");
  const shownName = () => session.getSnapshot().store.productOverview.name;
  const rename = (name: string) => {
    session.getSnapshot().store.setName({ name });
    session.flush();
  };
  // The file as Requireganizer writes it with the overview renamed, as a
  // version committed earlier; the shown project keeps its name.
  rename("From git");
  const fromGit = readFileSync(projectFile, "utf8");
  rename("Plant Pal");
  const checkOutFromGit = async () => {
    writeFileSync(projectFile, fromGit);
    await waitFor("the outside change", () => session.getSnapshot().outsideChange != null);
  };
  const changeOutside = async (contents: string | null, expected: unknown) => {
    if (contents == null) rmSync(projectFile);
    else writeFileSync(projectFile, contents);
    await waitFor("the outside change", () =>
      JSON.stringify(session.getSnapshot().outsideChange) === JSON.stringify(expected),
    );
  };
  return {
    projectFile,
    session,
    client,
    shownName,
    rename,
    checkOutFromGit,
    changeOutside,
    fromGit,
    dispose: () => {
      disconnect();
      session.dispose();
    },
  };
}

describe("a project file changed outside Requireganizer", () => {
  it("waits for the person's choice, then writes the shown version over the file when they keep it", async () => {
    const served = await servedProject();
    try {
      await served.checkOutFromGit();
      assert.deepEqual(served.session.getSnapshot().outsideChange, { kind: "changed", problem: null });

      // An edit made meanwhile is held back, not refused with an error.
      served.rename("Edited here");
      assert.match(readFileSync(served.projectFile, "utf8"), /From git/);
      assert.equal(served.session.getSnapshot().persistenceError, null);
      await assert.rejects(
        served.client.callAgentTool("get_workflow_state", {}),
        /requireganizer\.json changed outside Requireganizer\. Ask the person to choose/,
      );

      await served.client.keepShownProject();
      assert.match(readFileSync(served.projectFile, "utf8"), /Edited here/);
      assert.equal(served.session.getSnapshot().outsideChange, null);
    } finally {
      served.dispose();
    }
  });

  it("opens the changed file when the person chooses it, with the shown version one undo away", async (t) => {
    const logged = t.mock.method(console, "error");
    const served = await servedProject();
    try {
      await served.checkOutFromGit();
      const changed = readFileSync(served.projectFile, "utf8");
      // Made just before the change was noticed: its save is still waiting.
      served.session.getSnapshot().store.setName({ name: "Edited here" });

      await served.session.openChangedProject();
      assert.equal(served.shownName(), "From git");
      assert.equal(served.session.getSnapshot().outsideChange, null);
      // Opening changes nothing a version control system would see.
      assert.equal(readFileSync(served.projectFile, "utf8"), changed);

      undo();
      assert.equal(served.shownName(), "Edited here");
      // The edit held back while the person chose is no save failure.
      await delay(50);
      assert.equal(logged.mock.callCount(), 0);
    } finally {
      served.dispose();
    }
  });

  it("asks for the choice, with no save error, when a save finds the change before the watcher does", async () => {
    const served = await servedProject();
    try {
      writeFileSync(served.projectFile, readFileSync(served.projectFile, "utf8").replace("Plant Pal", "From git"));
      served.rename("Edited here");
      assert.equal(served.session.getSnapshot().outsideChange?.kind, "changed");
      await delay(0);
      assert.equal(served.session.getSnapshot().persistenceError, null);
      served.session.keepShownProject();
      assert.match(readFileSync(served.projectFile, "utf8"), /Edited here/);
    } finally {
      served.dispose();
    }
  });

  it("writes a removed file again under the project's own name", async () => {
    const served = await servedProject();
    try {
      await served.changeOutside(null, { kind: "removed" });
      await served.client.keepShownProject();
      const written = JSON.parse(readFileSync(served.projectFile, "utf8")) as { id: string; name: string };
      assert.deepEqual([written.id, written.name], ["project-1", "Plant Pal"]);
    } finally {
      served.dispose();
    }
  });

  it("neither keeps nor opens a version over a file it cannot read, and offers the choice again once it is fixed", async () => {
    const served = await servedProject();
    try {
      await served.changeOutside("<<<<<<< HEAD\n", {
        kind: "changed",
        problem: "requireganizer.json could not be read: requireganizer.json is not valid JSON. Fix the file, then try again.",
      });
      await assert.rejects(served.client.keepShownProject(), /cannot be read or holds another project/);
      await assert.rejects(served.client.openChangedProject(), /could not be read/);
      assert.equal(readFileSync(served.projectFile, "utf8"), "<<<<<<< HEAD\n");

      await served.changeOutside(served.fromGit, { kind: "changed", problem: null });
      // Not while Requireganizer works on the shown version.
      const store = served.session.getSnapshot().store;
      applySnapshot(store, { ...getSnapshot(store), businessCounter: 1 });
      await assert.rejects(served.client.openChangedProject(), /once Requireganizer finishes its current work/);
      applySnapshot(store, { ...getSnapshot(store), businessCounter: 0 });
      await served.client.openChangedProject();
      assert.equal(served.shownName(), "From git");
    } finally {
      served.dispose();
    }
  });

  it("writes what was held back once the file is checked out back to the version it holds", async () => {
    const served = await servedProject();
    try {
      const written = readFileSync(served.projectFile, "utf8");
      await served.checkOutFromGit();
      served.rename("Edited here");

      writeFileSync(served.projectFile, written);
      await waitFor("the change to be gone", () => served.session.getSnapshot().outsideChange == null);
      assert.match(readFileSync(served.projectFile, "utf8"), /Edited here/);
    } finally {
      served.dispose();
    }
  });
});
