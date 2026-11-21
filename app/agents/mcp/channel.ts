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

/** The channel event that tells a coding agent of a thread assigned to it, or that it was stopped working on one. */
export function channelNotice(notice: AgentNotice): ChannelNotification["params"] {
  const { waiting } = notice;
  const meta: Record<string, string> = { id: waiting.key, thread_id: waiting.thread.id, stage: waiting.stage, kind: waiting.kind };
  if (waiting.moduleName != null) meta.module = waiting.moduleName;
  return notice.type === "assigned"
    ? { content: `The spec owner assigned you a thread: ${notice.summary}.`, meta }
    : { content: `The spec owner stopped you working on a thread: ${notice.summary}. Your answer to it no longer counts; leave it.`, meta: { ...meta, stopped: "true" } };
}
