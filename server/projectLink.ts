import { WebSocket } from "ws";

import {
  type ClientConnection,
  type ClientConnectionListener,
  type ClientMessage,
  connectWebSocket,
  type LinkClosed,
  type LinkSocket,
  linkInProcess,
  linkUrlFor,
} from "connection";

import { type ProjectServer, type ProjectServerOptions, startProjectServer } from "./projectServer";
import { tokenCookieName } from "./projectSocket";
import { stateDirectoryFor, storedServerToken } from "./stateDirectory";

/**
 * Link to the server at `url` the way its own pages do: from its origin,
 * with its token, which only this user can read from the state directory.
 */
export function connectAsOwnPage(url: string, token: string): ClientConnection {
  const page = new URL(url);
  const cookie = `${tokenCookieName(Number(page.port))}=${token}`;
  return connectWebSocket(linkUrlFor(url), (address) => {
    const socket = new WebSocket(address, { headers: { origin: page.origin, cookie } });
    // A failed connect is followed by a close, which ends the link; unheard,
    // the error itself would end the process.
    socket.on("error", () => {});
    return socket as unknown as LinkSocket;
  });
}

/**
 * A connection whose link is still being found. Messages sent meanwhile wait
 * for it; a link that cannot be found ends the connection. `link` resolves to
 * what makes the link, so it is subscribed to as it is made: a link may
 * deliver its first message in the next microtask.
 */
function pendingConnection(link: Promise<() => ClientConnection>): ClientConnection {
  const listeners = new Set<ClientConnectionListener>();
  const waiting: ClientMessage[] = [];
  let ready: ClientConnection | null = null;
  let ended = false;

  const end = (reason: LinkClosed) => {
    if (ended) return;
    ended = true;
    const notified = [...listeners];
    listeners.clear();
    for (const listener of notified) listener.closed(reason);
  };

  link
    .then((makeLink) => {
      if (ended) return;
      const made = makeLink();
      ready = made;
      made.subscribe({
        message: (message) => {
          for (const listener of listeners) listener.message(message);
        },
        closed: end,
      });
      for (const message of waiting.splice(0)) made.send(message);
    })
    // A link that could not be found, made or written to.
    .catch((error: unknown) => {
      ready?.close();
      end({ retry: true, message: error instanceof Error ? error.message : String(error) });
    });

  return {
    send(message) {
      if (ended) throw new Error("The connection to the project host is closed.");
      if (ready == null) waiting.push(message);
      else ready.send(message);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    close() {
      if (ended) return;
      ended = true;
      listeners.clear();
      ready?.close();
    },
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** How long a server that claimed the project may take to say where it serves it. */
const STARTING_SERVER_WAIT_MS = 10_000;

/** The one host of a project, as a process that needs the project reaches it. */
export interface ProjectLink {
  /**
   * Make a connection to the project's host: this process's own server while
   * it serves the project, else the server of the process that does, else a
   * server this process starts. Each connection made after the host went
   * away elects the host again, so a process still connected takes over.
   */
  connect(): ClientConnection;
  /** Where the person opens the project, once known. */
  url(): string | null;
  /** Stop this process's server, if it serves the project; no connection made afterwards reaches a host. */
  close(): Promise<void>;
}

export function projectLink(
  options: Omit<ProjectServerOptions, "port"> & {
    /** Told each time this process starts serving the project. */
    onServing?: (server: ProjectServer) => void;
  },
): ProjectLink {
  const stateDirectory = stateDirectoryFor(options.projectFile);
  let serving: ProjectServer | null = null;
  let url: string | null = null;
  let closed = false;

  const elect = async (): Promise<() => ClientConnection> => {
    const deadline = Date.now() + STARTING_SERVER_WAIT_MS;
    for (;;) {
      if (serving != null) {
        const { host } = serving;
        return () => linkInProcess(host);
      }
      if (closed) throw new Error("The project link is closed.");
      const started = await startProjectServer(options);
      if ("serving" in started) {
        if (closed) {
          // Closed while the server started: it stops again at once.
          await started.serving.close();
          throw new Error("The project link is closed.");
        }
        serving = started.serving;
        url = serving.url;
        options.onServing?.(serving);
        const { host } = serving;
        return () => linkInProcess(host);
      }
      const token = storedServerToken(stateDirectory);
      if (started.heldBy.url != null && token != null) {
        const heldUrl = started.heldBy.url;
        url = heldUrl;
        return () => connectAsOwnPage(heldUrl, token);
      }
      if (Date.now() > deadline) {
        throw new Error("Another Requireganizer process claimed this project but has not started serving it.");
      }
      await delay(100);
    }
  };

  return {
    connect: () => pendingConnection(elect()),
    url: () => url,
    close: async () => {
      closed = true;
      const server = serving;
      serving = null;
      await server?.close();
    },
  };
}
