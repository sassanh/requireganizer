import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, request, type Server } from "node:http";
import { connect } from "node:net";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { WebSocket, WebSocketServer } from "ws";

import {
  connectWebSocket,
  type HostEndpoint,
  type HostMessage,
  LINK_CLOSE_CODES,
  linkClosedFor,
  linkUrlFor,
  PROTOCOL_VERSION,
} from "../app/connection";
import { environmentAiSettings } from "../server/aiEnvironment";
import { resolveProjectFile } from "../server/projectFile";
import { startProjectServer } from "../server/projectServer";
import { projectSocket, type ProjectSocket, tokenCookie } from "../server/projectSocket";
import { claimProject, serverToken, stateDirectoryFor } from "../server/stateDirectory";
import { serveStaticFiles } from "../server/staticFiles";

const directories: string[] = [];
after(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "requireganizer-server-"));
  directories.push(directory);
  return directory;
}

function listening(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
  });
}

/** A host that greets each link and echoes nothing; enough to see a link open. */
const greetingHost: HostEndpoint = {
  connect(send) {
    send({ type: "response", id: 0, ok: true, value: "hello" });
    return { receive: () => {}, close: () => {} };
  },
};

async function socketServer(): Promise<{ port: number; endpoint: ProjectSocket; close: () => Promise<void> }> {
  const server = createServer((_request, response) => response.end());
  let endpoint: ProjectSocket | null = null;
  server.on("upgrade", (request, socket, head) => {
    if (!endpoint?.upgrade(request, socket, head)) socket.destroy();
  });
  const port = await listening(server);
  endpoint = projectSocket({ host: greetingHost, port, token: "secret" });
  return {
    port,
    endpoint,
    close: () => new Promise((resolve) => {
      endpoint!.close();
      server.close(() => resolve());
    }),
  };
}

type Outcome = { refused: number } | { closed: number } | { greeted: WebSocket };

function attempt(url: string, headers: Record<string, string>): Promise<Outcome> {
  return new Promise((resolve) => {
    const socket = new WebSocket(url, { headers });
    socket.on("unexpected-response", (_request, response) => resolve({ refused: response.statusCode ?? 0 }));
    socket.on("message", () => resolve({ greeted: socket }));
    socket.on("close", (code) => resolve({ closed: code }));
    socket.on("error", () => {});
  });
}

describe("project server link", () => {
  it("accepts only its own pages: host, origin, token, and protocol version", async () => {
    const { port, close } = await socketServer();
    const own = `http://127.0.0.1:${port}`;
    const link = `ws://127.0.0.1:${port}/connect?protocol=${PROTOCOL_VERSION}`;
    const cookie = tokenCookie(port, "secret").split(";")[0]!;
    try {
      assert.deepEqual(await attempt(link, { origin: "https://evil.example", cookie }), { refused: 403 });
      assert.deepEqual(await attempt(link, { cookie }), { refused: 403 });
      // A name rebound to this machine still names another host.
      assert.deepEqual(
        await attempt(link, { origin: `http://evil.example:${port}`, host: `evil.example:${port}`, cookie }),
        { refused: 403 },
      );
      assert.deepEqual(await attempt(link, { origin: own, host: `evil.example:${port}`, cookie }), { refused: 403 });
      assert.deepEqual(
        await attempt(link, { origin: own, cookie: `requireganizer-${port}=guess` }),
        { closed: LINK_CLOSE_CODES.refused },
      );
      assert.deepEqual(
        await attempt(`ws://127.0.0.1:${port}/connect?protocol=0`, { origin: own, cookie }),
        { closed: LINK_CLOSE_CODES.outdated },
      );
      const accepted = await attempt(link, { origin: `http://localhost:${port}`, host: `localhost:${port}`, cookie });
      assert.ok("greeted" in accepted);
      accepted.greeted.close();
    } finally {
      await close();
    }
  });

  it("closes a link that sends anything but a request, and keeps serving", async () => {
    const { port, close } = await socketServer();
    const headers = { origin: `http://127.0.0.1:${port}`, cookie: tokenCookie(port, "secret").split(";")[0]! };
    const link = `ws://127.0.0.1:${port}/connect?protocol=${PROTOCOL_VERSION}`;
    try {
      for (const wire of [
        "null",
        "not json",
        JSON.stringify({ type: "event", id: 1, name: "undo", args: [] }),
        JSON.stringify({ type: "request", id: 1, name: "undo" }),
      ]) {
        const accepted = await attempt(link, headers);
        assert.ok("greeted" in accepted);
        const closed = new Promise((resolve) => accepted.greeted.on("close", resolve));
        accepted.greeted.send(wire);
        assert.equal(await closed, 1007, wire);
      }
      assert.ok("greeted" in (await attempt(link, headers)));
    } finally {
      await close();
    }
  });

  it("tells connected pages it is going away when it stops", async () => {
    const { port, close } = await socketServer();
    const cookie = tokenCookie(port, "secret").split(";")[0]!;
    const accepted = await attempt(`ws://127.0.0.1:${port}/connect?protocol=${PROTOCOL_VERSION}`, {
      origin: `http://127.0.0.1:${port}`,
      cookie,
    });
    assert.ok("greeted" in accepted);
    const closed = new Promise((resolve) => accepted.greeted.on("close", resolve));
    await close();
    assert.equal(await closed, 1001);
    assert.equal(linkClosedFor(1001).retry, true);
  });

  it("gives the page's token in an HttpOnly cookie named for the port", () => {
    assert.equal(tokenCookie(4519, "t"), "requireganizer-4519=t; Path=/; HttpOnly; SameSite=Strict");
  });
});

describe("browser WebSocket link", () => {
  it("waits for the socket to open, delivers messages in order, and reports a host-side close", async () => {
    const sockets = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    await new Promise((resolve) => sockets.on("listening", resolve));
    const port = (sockets.address() as AddressInfo).port;
    const received: string[] = [];
    sockets.on("connection", (socket) => {
      socket.on("message", (data) => {
        received.push(String(data));
        socket.send(JSON.stringify({ type: "response", id: 1, ok: true, value: "first" }));
        socket.send(JSON.stringify({ type: "response", id: 2, ok: true, value: "second" }));
        socket.close(LINK_CLOSE_CODES.outdated, "Old page.");
      });
    });
    try {
      const connection = connectWebSocket(`ws://127.0.0.1:${port}/connect`);
      const messages: HostMessage[] = [];
      const closed = new Promise<{ retry: boolean; message: string }>((resolve) => {
        connection.subscribe({ message: (message) => messages.push(message), closed: resolve });
      });
      // Sent before the socket opens; it waits for it.
      connection.send({ type: "request", id: 1, name: "undo", args: [] });
      const reason = await closed;
      assert.deepEqual(received.map((wire) => JSON.parse(wire).name), ["undo"]);
      assert.deepEqual(messages.map((message) => message.type === "response" && message.ok && message.value), ["first", "second"]);
      assert.equal(reason.retry, false);
      assert.match(reason.message, /Reload this page/);
    } finally {
      sockets.close();
    }
  });

  it("reaches the server that served the page, with the protocol version", () => {
    assert.equal(linkUrlFor("http://127.0.0.1:4519/project?id=a"), `ws://127.0.0.1:4519/connect?protocol=${PROTOCOL_VERSION}`);
    assert.equal(linkUrlFor("https://example.com/x"), `wss://example.com/connect?protocol=${PROTOCOL_VERSION}`);
    assert.equal(linkClosedFor(LINK_CLOSE_CODES.refused).retry, false);
    assert.equal(linkClosedFor(1006).retry, true);
  });
});

describe("static interface files", () => {
  async function serve(root: string): Promise<{ base: string; close: () => void }> {
    const server = createServer((request, response) => serveStaticFiles(root, request, response));
    const port = await listening(server);
    return { base: `http://127.0.0.1:${port}`, close: () => server.close() };
  }

  it("serves pages by name, caches hashed assets, and never leaves the root", async () => {
    const parent = temporaryDirectory();
    const root = join(parent, "ui");
    mkdirSync(join(root, "_next", "static"), { recursive: true });
    writeFileSync(join(root, "index.html"), "home");
    writeFileSync(join(root, "project.html"), "project");
    writeFileSync(join(root, "404.html"), "missing");
    writeFileSync(join(root, "_next", "static", "app.js"), "code");
    writeFileSync(join(parent, "secret.txt"), "secret");
    const { base, close } = await serve(root);
    try {
      const home = await fetch(`${base}/`);
      assert.equal(await home.text(), "home");
      assert.equal(home.headers.get("cache-control"), "no-cache");
      assert.equal(await (await fetch(`${base}/project?id=a`)).text(), "project");
      const asset = await fetch(`${base}/_next/static/app.js`);
      assert.match(asset.headers.get("content-type") ?? "", /javascript/);
      assert.match(asset.headers.get("cache-control") ?? "", /immutable/);
      const missing = await fetch(`${base}/nowhere`);
      assert.equal(missing.status, 404);
      assert.equal(await missing.text(), "missing");
      for (const path of ["/../secret.txt", "/..%2fsecret.txt", "/%2e%2e/secret.txt"]) {
        const escaped = await fetch(`${base}${path}`);
        assert.notEqual(await escaped.text(), "secret", path);
      }
      assert.equal((await fetch(`${base}/`, { method: "POST" })).status, 405);
    } finally {
      close();
    }
  });
});

describe("project server setup", () => {
  it("finds the nearest project file, or names a new one in the working directory", () => {
    const root = temporaryDirectory();
    const nested = join(root, "packages", "app");
    mkdirSync(nested, { recursive: true });
    assert.equal(resolveProjectFile(null, nested), join(nested, "requireganizer.json"));
    writeFileSync(join(root, "requireganizer.json"), "{}");
    assert.equal(resolveProjectFile(null, nested), join(root, "requireganizer.json"));
    assert.equal(resolveProjectFile("docs/plan.json", nested), join(nested, "docs", "plan.json"));
  });

  it("keeps one state directory per project file, with a token only the user reads", () => {
    const state = temporaryDirectory();
    const environment = { XDG_STATE_HOME: state };
    const first = stateDirectoryFor("/work/a/requireganizer.json", environment);
    assert.equal(stateDirectoryFor("/work/a/requireganizer.json", environment), first);
    assert.notEqual(stateDirectoryFor("/work/b/requireganizer.json", environment), first);
    assert.equal(readFileSync(join(first, "project-file.txt"), "utf8"), "/work/a/requireganizer.json\n");

    const token = serverToken(first);
    assert.ok(token.length >= 32);
    assert.equal(serverToken(first), token);
    assert.equal(statSync(join(first, "token")).mode & 0o777, 0o600);
  });

  it("reads the AI settings from the environment, with the defaults for what is unset", () => {
    const configured = environmentAiSettings({
      AI_API_KEY: " key ",
      AI_BASE_URL: "https://models.example.com/v1",
      AI_MODEL: "writer",
      AI_REVIEWER_MODEL: "reviewer",
    }).read();
    assert.deepEqual(configured, {
      apiKey: "key",
      baseUrl: "https://models.example.com/v1",
      model: "writer",
      reviewerModel: "reviewer",
    });
    const unset = environmentAiSettings({ AI_REVIEWER_MODEL: " " });
    assert.equal(unset.read().apiKey, "");
    assert.equal(unset.read().reviewerModel, null);
    assert.equal(unset.read().baseUrl, "https://openrouter.ai/api/v1");
    assert.match(unset.missingApiKeyMessage, /Set AI_API_KEY/);
    assert.throws(
      () => environmentAiSettings({ AI_BASE_URL: "openrouter.ai/api/v1" }),
      /AI_BASE_URL is "openrouter\.ai\/api\/v1", which is not an http or https URL/,
    );
  });
});

describe("project server", () => {
  async function started() {
    const root = temporaryDirectory();
    const previous = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = join(root, "state");
    try {
      return await startProjectServer({
        projectFile: join(root, "requireganizer.json"),
        aiSettings: environmentAiSettings({ AI_API_KEY: "test-key" }),
        port: 0,
        nextFreePort: false,
        serveInterface: (_request, response) => response.end("interface"),
      });
    } finally {
      if (previous == null) delete process.env.XDG_STATE_HOME;
      else process.env.XDG_STATE_HOME = previous;
    }
  }

  it("serves its pages only under its own name, with the token", async () => {
    const server = await started();
    try {
      const page = await fetch(server.url);
      assert.equal(await page.text(), "interface");
      assert.match(page.headers.get("set-cookie") ?? "", /HttpOnly; SameSite=Strict/);
      const port = new URL(server.url).port;
      const rebound = await new Promise<{ status: number; cookie: unknown }>((resolve) => {
        request({ host: "127.0.0.1", port, path: "/", headers: { host: `evil.example:${port}` } }, (response) => {
          response.resume();
          resolve({ status: response.statusCode ?? 0, cookie: response.headers["set-cookie"] });
        }).end();
      });
      assert.deepEqual(rebound, { status: 403, cookie: undefined });
    } finally {
      await server.close();
    }
  });

  it("survives request targets that are not paths", async () => {
    const server = await started();
    try {
      const port = Number(new URL(server.url).port);
      for (const target of ["//", "///", "*"]) {
        await new Promise<void>((resolve) => {
          const socket = connect(port, "127.0.0.1", () => {
            socket.end(`GET ${target} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`);
          });
          socket.on("data", () => {});
          socket.on("close", () => resolve());
          socket.on("error", () => resolve());
        });
      }
      for (const target of ["//", "///"]) {
        const upgrade = await attempt(`ws://127.0.0.1:${port}${target}`, { origin: `http://127.0.0.1:${port}` });
        assert.ok(!("greeted" in upgrade));
      }
      assert.equal(await (await fetch(server.url)).text(), "interface");
    } finally {
      await server.close();
    }
  });

  it("lets one server at a time claim a project, and takes over a claim left behind", () => {
    const state = temporaryDirectory();
    const claim = claimProject(state);
    claim.announce("http://127.0.0.1:4519/");
    assert.throws(() => claimProject(state), /already serving this project at http:\/\/127\.0\.0\.1:4519\//);
    claim.release();
    claimProject(state).release();
    // A claim whose process has ended is stale.
    writeFileSync(join(state, "server.json"), JSON.stringify({ pid: 2 ** 30, url: "http://127.0.0.1:1/" }));
    claimProject(state).release();
  });
});

