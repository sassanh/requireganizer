import type {
  ClientConnection,
  ClientMessage,
  HostEndpoint,
  HostMessage,
} from "./protocol";

/**
 * Link a client to a host in the same page. Each message is serialized when
 * sent and delivered in a later microtask, in order, so the in-process link
 * imposes what a socket would: JSON-only values and no synchronous answers.
 */
export function linkInProcess(host: HostEndpoint): ClientConnection {
  const listeners = new Set<(message: HostMessage) => void>();
  let closed = false;

  const hostLink = host.connect((message: HostMessage) => {
    const wire = JSON.stringify(message);
    queueMicrotask(() => {
      if (closed) return;
      const received = JSON.parse(wire) as HostMessage;
      for (const listener of listeners) listener(received);
    });
  });

  return {
    send(message: ClientMessage): void {
      if (closed) throw new Error("The connection to the project host is closed.");
      const wire = JSON.stringify(message);
      queueMicrotask(() => {
        if (!closed) hostLink.receive(JSON.parse(wire) as ClientMessage);
      });
    },
    subscribe(listener: (message: HostMessage) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    close(): void {
      if (closed) return;
      closed = true;
      listeners.clear();
      hostLink.close();
    },
  };
}
