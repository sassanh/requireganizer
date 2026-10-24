import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

import { type WebSocket, WebSocketServer } from "ws";

import {
  type HostEndpoint,
  LINK_CLOSE_CODES,
  LINK_PATH,
  parseClientMessage,
  PROTOCOL_VERSION,
} from "connection";

import { ownHosts, requestTarget } from "./requestTarget";

export interface ProjectSocketOptions {
  host: HostEndpoint;
  /** The port the server listens on; its pages are the only ones it accepts. */
  port: number;
  /** The secret the server's pages carry in a cookie. */
  token: string;
}

/** The cookie that carries the token, named per port so servers on one machine keep theirs apart. */
export function tokenCookieName(port: number): string {
  return `requireganizer-${port}`;
}

/** The header that gives a page of this server its token. */
export function tokenCookie(port: number, token: string): string {
  return `${tokenCookieName(port)}=${token}; Path=/; HttpOnly; SameSite=Strict`;
}

function cookieValue(header: string | undefined, name: string): string | null {
  for (const part of (header ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return null;
}

function serveLink(socket: WebSocket, host: HostEndpoint): void {
  const link = host.connect((message) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
  });
  socket.on("message", (data) => {
    const message = parseClientMessage(String(data));
    if (message == null) {
      socket.close(1007, "A message was not a request.");
      return;
    }
    link.receive(message);
  });
  socket.on("close", () => link.close());
  socket.on("error", () => socket.terminate());
}

export interface ProjectSocket {
  /** Take an upgrade request for the project link; false when it is not one. */
  upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): boolean;
  /** End every connection, telling pages the server is going away. */
  close(): void;
}

/** The close code for a server that stops; pages reconnect when it is back. */
const GOING_AWAY = 1001;

/**
 * The WebSocket endpoint pages of this server connect to. It accepts only
 * pages it served: the request must name this server as its host, come from
 * one of its own origins, and carry the token cookie its pages received.
 */
export function projectSocket(options: ProjectSocketOptions): ProjectSocket {
  const hosts = ownHosts(options.port);
  const origins = new Set([...hosts].map((host) => `http://${host}`));
  const sockets = new WebSocketServer({ noServer: true });
  const cookieName = tokenCookieName(options.port);

  const upgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): boolean => {
    const url = requestTarget(request);
    if (url?.pathname !== LINK_PATH) return false;
    // Another site, or a name rebound to this machine, never reaches the host.
    if (!hosts.has(request.headers.host ?? "") || !origins.has(request.headers.origin ?? "")) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return true;
    }
    sockets.handleUpgrade(request, socket, head, (webSocket) => {
      // Our own page, but one that cannot work here: it is told why.
      if (url.searchParams.get("protocol") !== String(PROTOCOL_VERSION)) {
        webSocket.close(LINK_CLOSE_CODES.outdated, "The page speaks another protocol version.");
        return;
      }
      if (cookieValue(request.headers.cookie, cookieName) !== options.token) {
        webSocket.close(LINK_CLOSE_CODES.refused, "The page has no valid token.");
        return;
      }
      serveLink(webSocket, options.host);
    });
    return true;
  };
  return {
    upgrade,
    close: () => {
      for (const client of sockets.clients) client.close(GOING_AWAY, "The server is stopping.");
      sockets.close();
    },
  };
}
