import type { AgentNotice } from "../desk";

/**
 * A Claude Code channel event: a session started with the MCP server as a
 * channel receives it as if the person had written it, and other clients
 * ignore it.
 */
export interface ChannelNotification {
  method: "notifications/claude/channel";
  params: { content: string; meta: Record<string, string> };
}

/** The channel event that tells a coding agent of a request given to it or stopped. */
export function channelNotice(notice: AgentNotice): ChannelNotification["params"] {
  const { request } = notice;
  const meta: Record<string, string> = { request: request.key };
  if (request.moduleName != null) meta.module = request.moduleName;
  if (request.thread == null) {
    meta.stage = request.stage;
    meta.kind = request.kind;
  } else {
    meta.thread_id = request.thread.id;
  }
  return notice.type === "given"
    ? { content: `The spec owner gives you a request: ${notice.summary}.`, meta }
    : { content: `The spec owner stopped your request: ${notice.summary}. Your answer to it no longer counts; leave it.`, meta: { ...meta, stopped: "true" } };
}
