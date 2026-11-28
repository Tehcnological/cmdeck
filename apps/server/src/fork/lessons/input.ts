import type { OrchestrationV2ConversationMessage } from "@t3tools/contracts";
import { redactSecrets } from "@t3tools/shared/redaction";
import * as DateTime from "effect/DateTime";

import { MENTION } from "../../scheduledTasks/webhookTemplate.ts";

/** The most conversation one pass reads; older new messages wait for the next pass. */
export const CONSOLIDATION_INPUT_MAX_CHARS = 24_000;
const MESSAGE_MAX_CHARS = 4_000;

export interface ConsolidationInput {
  /** The fenced conversation, or "" when nothing new is eligible. */
  readonly text: string;
  readonly messageCount: number;
  /** When the newest message read was created; the next pass starts after it. */
  readonly through: string | null;
}

/**
 * Only what a person typed and what the agent answered. Tool calls and their output are turn
 * items, never messages; notifications (monitor and check output), other threads' and links'
 * messages, delegated reports, scheduled and webhook prompts and workflow scripts are messages
 * nobody typed here, so a line in them saying "always run X" can never become a lesson.
 */
const isProse = (message: OrchestrationV2ConversationMessage): boolean => {
  if (message.streaming || message.text.trim() === "") return false;
  if (message.role === "assistant") return true;
  return (
    message.role === "user" &&
    message.createdBy === "user" &&
    message.notification === undefined &&
    message.senderThreadId === undefined &&
    message.linkedSender === undefined &&
    message.delegatedCompletion === undefined &&
    message.scheduledTaskId === undefined &&
    message.idleCompaction === undefined &&
    message.workflowScript !== true
  );
};

const clip = (text: string) =>
  text.length <= MESSAGE_MAX_CHARS ? text : `${text.slice(0, MESSAGE_MAX_CHARS)}…`;

// Tags inside a message cannot close its fence, and mentions cannot reach a provider CLI's parser.
const fenced = (message: OrchestrationV2ConversationMessage) =>
  `<message from="${message.role === "user" ? "user" : "assistant"}">\n${clip(
    redactSecrets(message.text).replaceAll(/<\/?(?:message|conversation)\b[^>]*>/giu, ""),
  ).replace(MENTION, "$&\u2060")}\n</message>`;

/**
 * The prose created after `after`, oldest first, as one fenced block within the size limit. When
 * it is over the limit the newest messages that fit are read and the older ones are skipped.
 */
export const consolidationInput = (
  messages: ReadonlyArray<OrchestrationV2ConversationMessage>,
  after: string | null,
): ConsolidationInput => {
  const since = after === null ? null : DateTime.makeUnsafe(after);
  const fresh = messages
    .filter((message) => since === null || DateTime.isGreaterThan(message.createdAt, since))
    .toSorted((left, right) => DateTime.Order(left.createdAt, right.createdAt));
  const newest = fresh.at(-1);
  const through = newest === undefined ? null : DateTime.formatIso(newest.createdAt);
  const open = "<conversation>\n";
  const close = "\n</conversation>";
  const blocks: Array<string> = [];
  // The limit holds for the whole block: its tags and the line break after each message count.
  let chars = open.length + close.length;
  for (const message of fresh.filter(isProse).toReversed()) {
    const block = fenced(message);
    if (chars + block.length + 1 > CONSOLIDATION_INPUT_MAX_CHARS) break;
    blocks.unshift(block);
    chars += block.length + 1;
  }
  return {
    text: blocks.length === 0 ? "" : `${open}${blocks.join("\n")}${close}`,
    messageCount: blocks.length,
    through,
  };
};
