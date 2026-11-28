import type { MessagingErrorReason } from "@t3tools/contracts";

/** Sender ids as typed: separated by commas, spaces or new lines. The server validates them. */
export const splitAllowlist = (text: string) =>
  text
    .split(/[\s,]+/)
    .map((id) => id.trim())
    .filter((id) => id !== "");

/** The reason a failed connect gave, when it was a messaging refusal. */
export const messagingErrorReason = (error: unknown): MessagingErrorReason | null =>
  typeof error === "object" &&
  error !== null &&
  "_tag" in error &&
  error._tag === "MessagingError" &&
  "reason" in error &&
  typeof error.reason === "string"
    ? (error.reason as MessagingErrorReason)
    : null;
