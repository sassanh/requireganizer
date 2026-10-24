import {
  type ClientConnection,
  type ClientConnectionListener,
  type ClientMessage,
  type HostMessage,
  LINK_CLOSE_CODES,
  LINK_PATH,
  type LinkClosed,
  PROTOCOL_VERSION,
} from "./protocol";

const LOST: LinkClosed = {
  retry: true,
  message: "The connection to the project server was lost. Reconnecting…",
};

/** What a close the client did not ask for means for the person using the page. */
export function linkClosedFor(code: number): LinkClosed {
  switch (code) {
    case LINK_CLOSE_CODES.outdated:
      return {
        retry: false,
        message: "The project server was updated. Reload this page.",
      };
    case LINK_CLOSE_CODES.refused:
      return {
        retry: false,
        message: "The project server no longer accepts this page. Reload it.",
      };
    default:
      return LOST;
  }
}

/** The address of the link a server serves alongside the page at `pageUrl`. */
export function linkUrlFor(pageUrl: string): string {
  const url = new URL(LINK_PATH, pageUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.search = new URLSearchParams({ protocol: String(PROTOCOL_VERSION) }).toString();
  return url.toString();
}

/** The part of a WebSocket the link uses, which the browser's and Node's `ws` both provide. */
export interface LinkSocket {
  readonly readyState: number;
  readonly OPEN: number;
  send(data: string): void;
  close(code?: number): void;
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(type: "close", listener: (event: { code: number }) => void): void;
}

/**
 * Link a client to a host over a WebSocket. Messages sent before the socket
 * opens wait for it; a close the client did not ask for reaches subscribers
 * once, with whether connecting again can help. `open` makes the socket,
 * where the browser's WebSocket is not the one to use.
 */
export function connectWebSocket(
  url: string,
  open: (url: string) => LinkSocket = (address) => new WebSocket(address),
): ClientConnection {
  const socket = open(url);
  const listeners = new Set<ClientConnectionListener>();
  const waiting: string[] = [];
  let ended = false;

  const end = (reason: LinkClosed) => {
    if (ended) return;
    ended = true;
    const notified = [...listeners];
    listeners.clear();
    for (const listener of notified) listener.closed(reason);
  };

  socket.addEventListener("open", () => {
    for (const wire of waiting.splice(0)) socket.send(wire);
  });
  socket.addEventListener("message", (event) => {
    if (ended) return;
    let message: HostMessage;
    try {
      message = JSON.parse(String(event.data)) as HostMessage;
    } catch {
      socket.close();
      end({
        retry: false,
        message: "The project server sent a message this page cannot read. Reload this page.",
      });
      return;
    }
    for (const listener of listeners) listener.message(message);
  });
  socket.addEventListener("close", (event) => end(linkClosedFor(event.code)));

  return {
    send(message: ClientMessage): void {
      if (ended) throw new Error("The connection to the project host is closed.");
      const wire = JSON.stringify(message);
      if (socket.readyState === socket.OPEN) socket.send(wire);
      else waiting.push(wire);
    },
    subscribe(listener: ClientConnectionListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    close(): void {
      if (ended) return;
      ended = true;
      listeners.clear();
      socket.close(1000);
    },
  };
}
