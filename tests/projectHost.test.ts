import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ToolCall } from "@earendil-works/pi-ai";
import { runInAction } from "mobx";
import { getSnapshot, onSnapshot } from "mobx-state-tree";

import { assistantMessage, scriptedStreamFn } from "./support/scriptedStream";
import {
  type AiSettings,
  aiSettings,
  configureAiSettings,
  DEFAULT_AI_SETTINGS,
} from "../app/ai-agent/settings";
import {
  type ClientConnection,
  type ClientConnectionListener,
  type HostMessage,
  type LinkClosed,
  linkInProcess,
} from "../app/connection";
import { UserFacingError } from "../app/lib/errors";
import type { ModuleEntry, ModuleRegistry } from "../app/lib/moduleSchema";
import { PROJECT_SCHEMA_VERSION } from "../app/lib/projectSchema";
import type { ProjectMeta } from "../app/lib/projectStorage";
import { MemoryPersistenceAdapter } from "../app/persistence";
import { ProjectClient } from "../app/project-client";
import { ProjectHost } from "../app/project-host";
import { ProjectSession } from "../app/project-session";
import { WorkflowStage } from "../app/store/constants";
import { Store } from "../app/store/store";
import { getCurrentStepKind } from "../app/store/timeline/controller";

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(description: string, condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${description}.`);
    await delay(0);
  }
}

/** A value as any stored or sent copy holds it: undefined properties dropped. */
function asJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

function moduleSnapshot(name: string, stories: string[] = []): Record<string, unknown> {
  const store = Store.create({ productOverview: {} });
  store.setName({ name });
  for (const content of stories) {
    store.addUserStory();
    store.userStories.at(-1)!.setContent(content);
  }
  return getSnapshot(store) as unknown as Record<string, unknown>;
}

function moduleEntry(id: string, snapshot: Record<string, unknown>): ModuleEntry {
  return {
    id,
    name: id,
    archivedAt: null,
    openStep: WorkflowStage.ProductOverview,
    snapshot,
  };
}

interface Opened {
  adapter: MemoryPersistenceAdapter;
  session: ProjectSession;
  host: ProjectHost;
  client: ProjectClient;
  authority: () => Store;
  replica: () => Store;
  dispose: () => void;
}

async function openProject(
  registry: ModuleRegistry,
  linkTo: (host: ProjectHost) => () => ClientConnection = (host) => () => linkInProcess(host),
): Promise<Opened> {
  const adapter = new MemoryPersistenceAdapter();
  await adapter.projects.saveIndex([
    { id: "project-a", name: "Alpha", description: "", updatedAt: "2026-10-23T00:00:00.000Z" },
  ]);
  await adapter.projects.save("project-a", {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    ...registry,
  });
  const session = new ProjectSession(adapter);
  const host = new ProjectHost(session);
  const client = new ProjectClient(linkTo(host));
  const disconnect = client.open();
  session.start();
  await client.selectProject("project-a", "Alpha");
  return {
    adapter,
    session,
    host,
    client,
    authority: () => session.getSnapshot().store,
    replica: () => client.getSnapshot().store,
    dispose: () => {
      disconnect();
      session.dispose();
    },
  };
}

function singleModule(stories: string[] = []): ModuleRegistry {
  return {
    modulesEnabled: false,
    activeModuleId: "module-a",
    modules: [moduleEntry("module-a", moduleSnapshot("Alpha", stories))],
  };
}

function twoModules(): ModuleRegistry {
  return {
    modulesEnabled: true,
    activeModuleId: "module-a",
    modules: [
      moduleEntry("module-a", moduleSnapshot("Alpha")),
      moduleEntry("module-b", moduleSnapshot("Beta")),
    ],
  };
}

/** In-process links whose host side can be made to end, as a dropped socket would. */
function droppableLinks() {
  const links: { drop(reason: LinkClosed): void }[] = [];
  const linkTo = (host: ProjectHost) => (): ClientConnection => {
    const inner = linkInProcess(host);
    let listener: ClientConnectionListener | null = null;
    links.push({
      drop: (reason) => {
        const current = listener;
        inner.close();
        current?.closed(reason);
      },
    });
    return {
      send: (message) => inner.send(message),
      subscribe: (next) => {
        listener = next;
        const stop = inner.subscribe(next);
        return () => {
          listener = null;
          stop();
        };
      },
      close: () => inner.close(),
    };
  };
  return { links, linkTo };
}

/** A raw link that records every message the host sends. */
function rawLink(host: ProjectHost): { link: ClientConnection; received: HostMessage[] } {
  const link = linkInProcess(host);
  const received: HostMessage[] = [];
  link.subscribe({
    message: (message) => received.push(message),
    closed: () => {},
  });
  return { link, received };
}

describe("project host and client", () => {
  it("shows the host's project in a replica of its own", async () => {
    const opened = await openProject(singleModule(["Water plants"]));
    try {
      const snapshot = opened.client.getSnapshot();
      assert.equal(snapshot.status, "ready");
      assert.deepEqual(snapshot.activeProject, { id: "project-a", name: "Alpha" });
      assert.deepEqual(snapshot.registry, opened.session.getSnapshot().registry);
      assert.notEqual(opened.replica(), opened.authority());
      assert.deepEqual(asJson(getSnapshot(opened.replica())), asJson(getSnapshot(opened.authority())));
    } finally {
      opened.dispose();
    }
  });

  it("forwards a root action and settles once the replica shows its result", async () => {
    const opened = await openProject(singleModule());
    try {
      const replica = opened.replica();
      const applied = replica.setName({ name: "Renamed" });
      assert.equal(replica.productOverview.name, "Alpha");
      assert.equal(opened.authority().productOverview.name, "Alpha");
      await applied;
      assert.equal(opened.authority().productOverview.name, "Renamed");
      assert.equal(replica.productOverview.name, "Renamed");
    } finally {
      opened.dispose();
    }
  });

  it("forwards an action called on a nested node to the same node on the host", async () => {
    const opened = await openProject(singleModule(["Water plants", "Feed plants"]));
    try {
      await opened.replica().userStories[1]!.setContent("Repot plants");
      assert.equal(opened.authority().userStories[1]!.content, "Repot plants");
      assert.equal(opened.authority().userStories[0]!.content, "Water plants");
    } finally {
      opened.dispose();
    }
  });

  it("refuses arguments that JSON would not carry unchanged", async () => {
    const opened = await openProject(singleModule(["Water plants"]));
    try {
      const replica = opened.replica();
      await assert.rejects(
        Promise.resolve(
          replica.requestChange(replica.userStories[0]! as unknown as string, "Shorter."),
        ),
        /store node/,
      );
      await assert.rejects(
        Promise.resolve(replica.generateTestCases(undefined as unknown as null, "hint")),
        /undefined/,
      );
      await assert.rejects(
        Promise.resolve(
          replica.sendConversationMessage({ message: "Hi" }, () => undefined as never),
        ),
        /function/,
      );
      await assert.rejects(
        opened.client.persistence.projects.saveIndex([() => undefined] as never),
        /function/,
      );
      assert.equal(opened.authority().thinkingLabel, null);
    } finally {
      opened.dispose();
    }
  });

  it("drops trailing undefined arguments, which read back the same", async () => {
    const opened = await openProject(singleModule());
    try {
      const retry = opened.replica().retryFailedOperation as (...args: unknown[]) => unknown;
      assert.equal(await retry(undefined), null);
    } finally {
      opened.dispose();
    }
  });

  it("rejects with the host's user-facing error", async () => {
    const opened = await openProject(singleModule(["Water plants"]));
    try {
      await assert.rejects(
        Promise.resolve(opened.replica().setReviewMode(WorkflowStage.UserStories, "auto")),
        (error: unknown) =>
          error instanceof UserFacingError &&
          /No reviewer model is configured/.test(error.message),
      );
    } finally {
      opened.dispose();
    }
  });

  it("shows a switched module and refuses actions meant for the previous one", async () => {
    const opened = await openProject(twoModules());
    try {
      const previous = opened.replica();
      assert.equal(await opened.client.switchModule("module-b"), true);
      assert.notEqual(opened.replica(), previous);
      assert.equal(opened.replica().productOverview.name, "Beta");
      assert.equal(opened.client.getSnapshot().registry?.activeModuleId, "module-b");

      await assert.rejects(
        Promise.resolve(previous.setName({ name: "Meant for Alpha" })),
        /module changed/,
      );
      assert.equal(opened.authority().productOverview.name, "Beta");
      assert.equal(await opened.client.switchModule("missing"), false);
    } finally {
      opened.dispose();
    }
  });

  it("rejects a session operation the host refuses", async () => {
    const opened = await openProject(twoModules());
    try {
      await assert.rejects(opened.client.addModule("module-b"), /module-b/i);
      await assert.rejects(opened.client.addModule("   "), /cannot be empty/);
    } finally {
      opened.dispose();
    }
  });

  it("mirrors the volatile state the interface reads", async () => {
    const opened = await openProject(singleModule());
    try {
      const authority = opened.authority();
      authority.beginAiOperation({ operation: "draft the overview", controller: new AbortController() });
      authority.appendThinking("Thinking about plants");
      await waitFor("thinking text", () => opened.replica().thinkingText.length > 0);
      assert.equal(opened.replica().thinkingLabel, "draft the overview");
      assert.equal(opened.replica().thinkingText, "Thinking about plants");
      assert.equal(opened.replica().aiAbortController, null);

      authority.endAiOperation();
      await waitFor("the end of the operation", () => opened.replica().thinkingLabel == null);
      assert.equal(opened.replica().thinkingText, "");
    } finally {
      opened.dispose();
    }
  });

  it("keeps provider calls the host recorded while the stored ones were read", async () => {
    const opened = await openProject(singleModule());
    try {
      const call = (id: string, startedAt: string) => ({
        id,
        operation: id,
        attempt: 1,
        promptVersion: "v",
        protocolVersion: 6,
        startedAt,
        durationMs: 1,
        provider: "provider",
        model: "model",
        outcome: "success" as const,
        toolCallCount: 0,
      });
      const recorded = call("recorded", "2026-10-23T10:00:00.000Z");
      opened.authority().hydrateProviderCalls([recorded]);
      await opened.replica().hydrateProviderCalls([call("stored", "2026-10-23T09:00:00.000Z")]);
      assert.deepEqual(opened.authority().providerCalls.map(({ id }) => id), ["stored", "recorded"]);
      assert.deepEqual(opened.replica().providerCalls.map(({ id }) => id), ["stored", "recorded"]);
    } finally {
      opened.dispose();
    }
  });

  it("keeps sibling stores when only another part of the registry changed", async () => {
    const opened = await openProject(twoModules());
    try {
      const sibling = opened.replica().siblingModules[0]?.store;
      assert.ok(sibling != null);
      await opened.client.recordOpenStep(WorkflowStage.UserStories);
      assert.equal(
        opened.client.getSnapshot().registry?.modules[0]?.openStep,
        WorkflowStage.UserStories,
      );
      assert.equal(opened.replica().siblingModules[0]?.store, sibling);
    } finally {
      opened.dispose();
    }
  });

  it("replays a store event after the change it was emitted with", async () => {
    const opened = await openProject(singleModule());
    try {
      const seen: { step: WorkflowStage; name: string | null }[] = [];
      const replica = opened.replica();
      replica.eventTarget.on("stepUpdate", (step) => {
        seen.push({ step, name: replica.productOverview.name });
      });
      const authority = opened.authority();
      authority.setName({ name: "Emitted" });
      authority.eventTarget.emit("stepUpdate", WorkflowStage.UserStories);
      await waitFor("the step update", () => seen.length > 0);
      assert.deepEqual(seen, [{ step: WorkflowStage.UserStories, name: "Emitted" }]);
    } finally {
      opened.dispose();
    }
  });

  it("replays a store event with the state its whole change left", async () => {
    const opened = await openProject(singleModule());
    try {
      const seen: (string | null)[] = [];
      const replica = opened.replica();
      replica.eventTarget.on("stepUpdate", () => seen.push(replica.productOverview.name));
      const authority = opened.authority();
      runInAction(() => {
        authority.eventTarget.emit("stepUpdate", WorkflowStage.UserStories);
        authority.setName({ name: "Finished" });
      });
      await waitFor("the step update", () => seen.length > 0);
      // A replica never shows half of a change.
      assert.deepEqual(seen, ["Finished"]);
    } finally {
      opened.dispose();
    }
  });

  it("delivers an AI turn's change focus after its changes, with the turn kind current", async () => {
    const opened = await openProject(singleModule());
    try {
      const replica = opened.replica();
      const kinds: (string | null)[] = [];
      onSnapshot(replica, () => kinds.push(opened.client.changeSource.currentStepKind()));
      const focused: { subjects: string[]; purpose: string | null }[] = [];
      opened.client.changeSource.onChangeFocus((focus) => {
        focused.push({
          subjects: focus.ops.map((op) => op.subject),
          purpose: replica.productOverview.purpose,
        });
      });
      const authorityKinds: (string | null)[] = [];
      onSnapshot(opened.authority(), () => authorityKinds.push(getCurrentStepKind()));

      const toolCall: ToolCall = {
        type: "toolCall",
        id: "call-1",
        name: "submit_product_overview",
        arguments: {
          name: "Alpha",
          purpose: "Help people keep houseplants alive.",
          primaryFeatures: ["Track watering schedules"],
          targetUsers: ["Busy plant owners"],
        },
      };
      await opened.authority().sendConversationMessage(
        { message: "Draft the overview." },
        scriptedStreamFn([
          assistantMessage([toolCall]),
          assistantMessage([{ type: "text", text: "Product overview applied." }]),
        ]),
      );
      await waitFor("the change focus", () => focused.length > 0);

      assert.equal(replica.productOverview.purpose, "Help people keep houseplants alive.");
      assert.ok(focused[0]!.subjects.includes("productOverview/purpose"));
      // The replica already shows the change its focus describes.
      assert.equal(focused[0]!.purpose, "Help people keep houseplants alive.");
      assert.ok(authorityKinds.includes("ai"));
      assert.ok(kinds.includes("ai"));
      assert.equal(opened.client.changeSource.currentStepKind(), null);
      assert.deepEqual(asJson(getSnapshot(replica)), asJson(getSnapshot(opened.authority())));
    } finally {
      opened.dispose();
    }
  });

  it("moves through the timeline on the client's request", async () => {
    const opened = await openProject(singleModule());
    try {
      await opened.replica().setName({ name: "Renamed" });
      await waitFor("undo to become available", () => opened.client.timeline.getMeta().canUndo);
      const replica = opened.replica();
      const order: string[] = [];
      onSnapshot(replica, () => order.push("snapshot"));
      opened.client.changeSource.onChangeFocus(() => {
        order.push(`focus with ${replica.productOverview.name}`);
      });
      await opened.client.timeline.undo();
      // As next to a local store: presenters get the focus with the change
      // already in place, and store observers run after them.
      assert.deepEqual(order, ["focus with Alpha", "snapshot"]);
      assert.equal(opened.replica().productOverview.name, "Alpha");
      assert.equal(opened.authority().productOverview.name, "Alpha");
      assert.equal(opened.client.timeline.getMeta().canRedo, true);
      const exported = await opened.client.timeline.exportSnapshot();
      assert.ok(exported != null && exported.nodes.length >= 2);
    } finally {
      opened.dispose();
    }
  });

  it("serves the host's storage, keeping a read after a write consistent", async () => {
    const opened = await openProject(singleModule());
    try {
      const { persistence } = opened.client;
      const projects = await persistence.projects.list();
      assert.deepEqual(projects, await opened.adapter.projects.list());

      const added = { id: "project-b", name: "Beta", description: "", updatedAt: "2026-10-23T00:00:00.000Z" };
      const written = persistence.projects.saveIndex([...projects, added]);
      const listed = persistence.projects.list();
      await written;
      assert.deepEqual((await listed).map((project) => project.id), ["project-a", "project-b"]);

      const saved = await persistence.revisions.save("project-a", "module-a", { marker: 1 }, "Before");
      assert.deepEqual(
        (await persistence.revisions.list("project-a", "module-a")).map((revision) => revision.id),
        [saved.id],
      );
    } finally {
      opened.dispose();
    }
  });

  it("refuses requests and storage operations the protocol does not name", async () => {
    const opened = await openProject(singleModule());
    const { link, received } = rawLink(opened.host);
    try {
      link.send({
        type: "request",
        id: 1,
        name: "runPersistence",
        args: [{ group: "projects", method: "constructor", args: [] }],
      });
      link.send({
        type: "request",
        id: 2,
        name: "toString" as never,
        args: [],
      });
      link.send({
        type: "request",
        id: 3,
        name: "runStoreAction",
        args: [{ store: "", address: [], name: "setName", args: [{ name: "x" }] }],
      });
      await waitFor("three answers", () =>
        received.filter((message) => message.type === "response").length === 3,
      );
      const errors = received.flatMap((message) =>
        message.type === "response" && !message.ok ? [message.error.message] : [],
      );
      assert.equal(errors.length, 3);
      assert.match(errors[0]!, /no operation projects\.constructor/);
      assert.match(errors[1]!, /no request named toString/);
      assert.match(errors[2]!, /module changed/);
      assert.equal(opened.authority().productOverview.name, "Alpha");
    } finally {
      link.close();
      opened.dispose();
    }
  });

  it("tells clients which reviewer model the host's AI uses, and when that changes", async () => {
    const previous = aiSettings();
    let settings: AiSettings = { ...DEFAULT_AI_SETTINGS, reviewerModel: null };
    const listeners = new Set<() => void>();
    configureAiSettings({
      read: () => settings,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      missingApiKeyMessage: "Add a key.",
      missingReviewerModelMessage: "Pick a reviewer.",
    });
    try {
      const opened = await openProject(singleModule());
      try {
        assert.deepEqual(opened.client.getHostInfo(), {
          reviewerModel: null,
          missingReviewerModelMessage: "Pick a reviewer.",
          storage: { singleProject: false, name: "memory" },
        });
        assert.equal(opened.client.persistence.traits.name, "memory");
        await assert.rejects(
          Promise.resolve(opened.replica().setReviewMode(WorkflowStage.UserStories, "auto")),
          /Pick a reviewer\./,
        );
        settings = { ...settings, reviewerModel: "judge" };
        for (const listener of listeners) listener();
        await waitFor("the new reviewer", () => opened.client.getHostInfo().reviewerModel === "judge");
      } finally {
        opened.dispose();
      }
      assert.equal(listeners.size, 0);
    } finally {
      configureAiSettings(previous);
    }
  });

  it("refuses to run a store member that is not an action", async () => {
    const opened = await openProject(singleModule());
    const { link, received } = rawLink(opened.host);
    try {
      const isSession = (message: HostMessage) =>
        message.type === "event" && message.event.type === "session";
      await waitFor("the first image", () => received.some(isSession));
      const first = received.find(isSession)!;
      assert.ok(first.type === "event" && first.event.type === "session");
      const storeId = first.event.store!.id;
      link.send({
        type: "request",
        id: 1,
        name: "runStoreAction",
        args: [{ store: storeId, address: [], name: "stageLabel", args: ["user-stories"] }],
      });
      await waitFor("the answer", () => received.some((message) => message.type === "response"));
      const response = received.find((message) => message.type === "response")!;
      assert.ok(response.type === "response" && !response.ok);
      assert.match(response.error.message, /stageLabel is not a store action/);
    } finally {
      link.close();
      opened.dispose();
    }
  });

  it("starts a late client from the current state without replaying changes", async () => {
    const opened = await openProject(singleModule(["Water plants"]));
    try {
      opened.authority().addUserStory();
      const late = new ProjectClient(() => linkInProcess(opened.host));
      const disconnect = late.open();
      try {
        await waitFor("the late client's project", () => late.getSnapshot().status === "ready");
        await waitFor("the first client's update", () => opened.replica().userStories.length === 2);
        assert.equal(late.getSnapshot().store.userStories.length, 2);

        await late.getSnapshot().store.setName({ name: "Shared" });
        await waitFor("the first client's rename", () => opened.replica().productOverview.name === "Shared");
        assert.deepEqual(
          asJson(getSnapshot(late.getSnapshot().store)),
          asJson(getSnapshot(opened.authority())),
        );
      } finally {
        disconnect();
      }
    } finally {
      opened.dispose();
    }
  });

  it("answers requests made before the connection opens once it does", async () => {
    const adapter = new MemoryPersistenceAdapter();
    await adapter.projects.saveIndex([
      { id: "project-a", name: "Alpha", description: "", updatedAt: "2026-10-23T00:00:00.000Z" },
    ]);
    const host = new ProjectHost(new ProjectSession(adapter));
    const client = new ProjectClient(() => linkInProcess(host));
    // A child component's mount effect runs before the provider opens the link.
    const listed = client.persistence.projects.list();
    const disconnect = client.open();
    try {
      assert.deepEqual((await listed).map((project) => project.id), ["project-a"]);
    } finally {
      disconnect();
    }
  });

  it("fails sent requests on disconnect and holds new ones until it reconnects", async () => {
    const adapter = new MemoryPersistenceAdapter();
    const host = new ProjectHost(new ProjectSession(adapter));
    const client = new ProjectClient(() => linkInProcess(host));
    // Made before any connection opened: it waits, through a disconnect too.
    const early = client.persistence.projects.list();
    const disconnect = client.open();
    disconnect();
    const reconnect = client.open();
    try {
      assert.deepEqual(await early, []);
      const sent = client.timeline.undo();
      reconnect();
      await assert.rejects(sent, /closed/);
    } finally {
      reconnect();
    }

    const held = client.persistence.projects.list();
    const again = client.open();
    try {
      assert.deepEqual(await held, []);
    } finally {
      again();
    }
  });

  it("drafts the overview of a project opened with a starting intent", async (t) => {
    t.mock.method(console, "error", () => {});
    const adapter = new MemoryPersistenceAdapter();
    await adapter.projects.saveIndex([
      { id: "project-a", name: "Alpha", description: "", updatedAt: "2026-10-23T00:00:00.000Z" },
    ]);
    const session = new ProjectSession(adapter);
    const host = new ProjectHost(session);
    const client = new ProjectClient(() => linkInProcess(host));
    const disconnect = client.open();
    try {
      await client.selectProject("project-a", "Alpha", { overviewSeed: "A plant helper." });
      await waitFor("the seed", () => session.getSnapshot().store.overviewSeed != null);
      assert.equal(session.getSnapshot().store.overviewSeed, "A plant helper.");
      assert.equal(session.consumeOverviewSeed("project-a"), null);
      await waitFor("the draft to settle", () => !session.getSnapshot().store.isBusy);
    } finally {
      disconnect();
      session.dispose();
    }
  });

  it("tells an agent which module it works on: the one the page shows", async () => {
    const workflowModule = async (client: ProjectClient) =>
      (JSON.parse(await client.callAgentTool("get_workflow_state", {}, { name: "Test agent" })) as { module?: string }).module;
    const modules = await openProject(twoModules());
    try {
      assert.equal(await workflowModule(modules.client), "module-a");
      await modules.client.switchModule("module-b");
      assert.equal(await workflowModule(modules.client), "module-b");
    } finally {
      modules.dispose();
    }
    const single = await openProject(singleModule());
    try {
      assert.equal(await workflowModule(single.client), undefined);
    } finally {
      single.dispose();
    }
  });

  it("refuses an agent's tool call while an import is replacing the project", async (t) => {
    const opened = await openProject(singleModule());
    try {
      let landWrite = () => {};
      t.mock.method(
        opened.adapter.projects,
        "save",
        () => new Promise<void>((resolve) => (landWrite = resolve)),
      );
      const imported = opened.client.importProjectFile({
        schemaVersion: PROJECT_SCHEMA_VERSION,
        ...singleModule(["Imported story"]),
      });
      await assert.rejects(
        opened.client.callAgentTool("submit_product_overview", {
          name: "Plant Pal",
          purpose: "Keep plants alive.",
          primaryFeatures: ["Track watering schedules"],
          targetUsers: ["Busy plant owners"],
        }, { name: "Test agent" }),
        /A project import is replacing this project/,
      );
      assert.notEqual(opened.authority().productOverview.name, "Plant Pal");
      landWrite();
      await imported;
    } finally {
      opened.dispose();
    }
  });
});

describe("project host and client over a link that can fail", () => {
  it("addresses an item by its id, so an action lands on it after earlier items move", async () => {
    const opened = await openProject(singleModule(["Water plants", "Feed plants"]));
    try {
      const pending = opened.replica().userStories[1]!.setContent("Repot plants");
      // Before the action reaches the host, the item ahead of it goes away there.
      const authority = opened.authority();
      authority.removeUserStory({ fragment: authority.userStories[0]! });
      await pending;
      assert.deepEqual(
        opened.authority().userStories.map((story) => story.content),
        ["Repot plants"],
      );
      assert.deepEqual(
        opened.replica().userStories.map((story) => story.content),
        ["Repot plants"],
      );
    } finally {
      opened.dispose();
    }
  });

  it("sends streamed text as what was added to its end", async () => {
    const opened = await openProject(singleModule());
    const { link, received } = rawLink(opened.host);
    try {
      opened.authority().appendThinking("Reading the overview");
      opened.authority().appendThinking(", then the stories.");
      await waitFor("the streamed text", () =>
        opened.replica().thinkingText === "Reading the overview, then the stories.",
      );
      const updates = received.flatMap((message) =>
        message.type === "event" && message.event.type === "store-update" ? [message.event.update] : [],
      );
      assert.ok(updates.some((update) => update.volatile.thinkingText === "Reading the overview"));
      const appended = updates.find((update) => update.appended.thinkingText != null);
      assert.equal(appended?.appended.thinkingText, ", then the stories.");
      assert.equal(appended?.volatile.thinkingText, undefined);
    } finally {
      link.close();
      opened.dispose();
    }
  });

  it("leaves out module snapshots every client already holds", async () => {
    const opened = await openProject(twoModules());
    const { link, received } = rawLink(opened.host);
    try {
      const before = opened.client.getSnapshot().registry!;
      await opened.client.recordOpenStep(WorkflowStage.UserStories);
      const sent = received.flatMap((message) =>
        message.type === "event" && message.event.type === "session" && message.event.registry != null
          ? [message.event.registry]
          : [],
      ).at(-1)!;
      assert.ok(sent.modules.every((entry) => entry.snapshot === undefined));
      const after = opened.client.getSnapshot().registry!;
      assert.equal(after.modules[0]!.openStep, WorkflowStage.UserStories);
      assert.equal(after.modules[1]!.snapshot, before.modules[1]!.snapshot);

      // Switching away writes the outgoing module's snapshot, which is sent.
      await opened.replica().setName({ name: "Alpha 2" });
      assert.equal(await opened.client.switchModule("module-b"), true);
      const switched = opened.client.getSnapshot().registry!;
      const outgoing = switched.modules.find((entry) => entry.id === "module-a")!;
      assert.equal(
        (outgoing.snapshot.productOverview as { name: string }).name,
        "Alpha 2",
      );
      assert.equal(opened.replica().productOverview.name, "Beta");
    } finally {
      link.close();
      opened.dispose();
    }
  });

  it("refuses an action addressed to a store image of an earlier host", async () => {
    const opened = await openProject(singleModule());
    const earlier = rawLink(opened.host);
    const later = new ProjectHost(opened.session);
    const { link, received } = rawLink(later);
    try {
      const isSession = (message: HostMessage) =>
        message.type === "event" && message.event.type === "session";
      await waitFor("both images", () => earlier.received.some(isSession) && received.some(isSession));
      const earlierImage = earlier.received.find(isSession)!;
      assert.ok(earlierImage.type === "event" && earlierImage.event.type === "session");
      link.send({
        type: "request",
        id: 1,
        name: "runStoreAction",
        args: [{ store: earlierImage.event.store!.id, address: [], name: "setName", args: [{ name: "x" }] }],
      });
      await waitFor("the answer", () => received.some((message) => message.type === "response"));
      const response = received.find((message) => message.type === "response")!;
      assert.ok(response.type === "response" && !response.ok);
      assert.match(response.error.message, /module changed/);
      assert.notEqual(opened.authority().productOverview.name, "x");
    } finally {
      link.close();
      earlier.link.close();
      opened.dispose();
    }
  });

  it("fails what was in flight when the link drops, then reconnects and resumes", async () => {
    const { links, linkTo } = droppableLinks();
    const opened = await openProject(singleModule(["Water plants"]), linkTo);
    try {
      assert.deepEqual(opened.client.getConnectionStatus(), { state: "open" });
      const inFlight = opened.client.persistence.projects.list();
      links[0]!.drop({ retry: true, message: "The connection was lost." });
      await assert.rejects(inFlight, (error: unknown) =>
        error instanceof UserFacingError && error.message === "The connection was lost.",
      );
      assert.deepEqual(opened.client.getConnectionStatus(), {
        state: "reconnecting",
        message: "The connection was lost.",
      });

      // Changed while the client was away; the next connection starts from it.
      opened.authority().userStories[0]!.setContent("Feed plants");
      const waiting = opened.client.persistence.projects.list();
      await waitFor("the reconnect", () => opened.client.getConnectionStatus().state === "open");
      assert.equal(links.length, 2);
      assert.deepEqual((await waiting).map((project) => project.id), ["project-a"]);
      assert.equal(opened.replica().userStories[0]!.content, "Feed plants");
      await opened.replica().userStories[0]!.setContent("Repot plants");
      assert.equal(opened.authority().userStories[0]!.content, "Repot plants");
    } finally {
      opened.dispose();
    }
  });

  it("keeps requests made while reconnecting through an attempt that fails before opening", async () => {
    const { links, linkTo } = droppableLinks();
    let attempts = 0;
    let duringAttempt: Promise<ProjectMeta[]> | null = null;
    const opened = await openProject(singleModule(["Water plants"]), (host) => {
      const live = linkTo(host);
      return () => {
        attempts += 1;
        if (attempts !== 2) return live();
        // The server is still down: the socket closes before any message,
        // and a request is made while it is trying.
        let listener: ClientConnectionListener | null = null;
        queueMicrotask(() => {
          duringAttempt = opened.client.persistence.projects.list();
        });
        setTimeout(() => listener?.closed({ retry: true, message: "Still down." }), 0);
        return {
          send: () => {},
          subscribe: (next) => {
            listener = next;
            return () => {
              listener = null;
            };
          },
          close: () => {},
        };
      };
    });
    try {
      links[0]!.drop({ retry: true, message: "The connection was lost." });
      const waiting = opened.client.persistence.projects.list();
      assert.deepEqual((await waiting).map((project) => project.id), ["project-a"]);
      assert.equal(attempts, 3);
      // Assigned by the link factory, which the compiler cannot see.
      const during = duringAttempt as Promise<ProjectMeta[]> | null;
      assert.ok(during != null);
      assert.deepEqual((await during).map((project) => project.id), ["project-a"]);
    } finally {
      opened.dispose();
    }
  });

  it("fails every request once the link ends for good", async () => {
    const { links, linkTo } = droppableLinks();
    const opened = await openProject(singleModule(), linkTo);
    try {
      links[0]!.drop({ retry: false, message: "Reload this page." });
      assert.deepEqual(opened.client.getConnectionStatus(), {
        state: "failed",
        message: "Reload this page.",
      });
      await assert.rejects(opened.client.persistence.projects.list(), /Reload this page\./);
      await delay(700);
      assert.equal(links.length, 1);
    } finally {
      opened.dispose();
    }
  });
});
