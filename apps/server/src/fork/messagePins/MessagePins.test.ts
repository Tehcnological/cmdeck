import { describe, expect, it } from "@effect/vitest";
import {
  MESSAGE_PIN_PREVIEW_LENGTH,
  MESSAGE_PINS_PER_THREAD,
  MessageId,
  MessagePinsError,
  type OrchestrationV2ConversationMessage,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as Sqlite from "../../persistence/Sqlite.ts";
import * as MessagePins from "./MessagePins.ts";

// Built from parts so no literal token sits in the source.
const fakeToken = ["gh", "p_", "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8"].join("");
const fakePem = [
  "-----BEGIN PRIVATE KEY-----",
  "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7".repeat(8),
  "-----END PRIVATE KEY-----",
].join("\n");

const thread = ThreadId.make("thread-pins");
const otherThread = ThreadId.make("thread-other");
const message = (n: number) => MessageId.make(`message-${n}`);

/** Messages the projection holds, by thread then id; a test adds the ones it pins. */
const stored = new Map<string, Map<string, OrchestrationV2ConversationMessage>>();
const store = (
  threadId: ThreadId,
  messageId: MessageId,
  text: string,
  role: "user" | "assistant" | "system" = "user",
  streaming = false,
) => {
  const messages = stored.get(threadId) ?? new Map();
  messages.set(messageId, {
    id: messageId,
    threadId,
    role,
    text,
    streaming,
  } as OrchestrationV2ConversationMessage);
  stored.set(threadId, messages);
};

const layer = MessagePins.layer.pipe(
  Layer.provideMerge(Sqlite.layerMemory),
  Layer.provide(
    Layer.mock(ProjectionStore.ProjectionStoreV2)({
      getMessagesById: (threadId, ids) =>
        Effect.succeed(
          new Map(
            ids.flatMap((id) => {
              const found = stored.get(threadId)?.get(id);
              return found === undefined ? [] : [[id, found] as const];
            }),
          ),
        ),
    }),
  ),
);

describe("MessagePins", () => {
  it.layer(layer)((it) => {
    it.effect("pins, lists oldest first per thread, and unpins", () =>
      Effect.gen(function* () {
        const pins = yield* MessagePins.MessagePins;
        store(thread, message(1), "a", "user");
        store(thread, message(2), "b", "assistant");
        store(otherThread, message(3), "c", "user");
        yield* pins.pin({ threadId: thread, messageId: message(1) });
        yield* TestClock.adjust("1 second");
        yield* pins.pin({ threadId: thread, messageId: message(2) });
        yield* pins.pin({ threadId: otherThread, messageId: message(3) });

        expect((yield* pins.list(thread)).map((pin) => [pin.messageId, pin.role])).toEqual([
          [message(1), "user"],
          [message(2), "assistant"],
        ]);

        yield* pins.unpin({ threadId: thread, messageId: message(1) });
        // Unpinning again is not an error: two clients may unpin the same message.
        yield* pins.unpin({ threadId: thread, messageId: message(1) });
        expect((yield* pins.list(thread)).map((pin) => pin.messageId)).toEqual([message(2)]);
        expect((yield* pins.list(otherThread)).map((pin) => pin.messageId)).toEqual([message(3)]);
      }),
    );

    it.effect("pinning a pinned message keeps the first pin", () =>
      Effect.gen(function* () {
        const pins = yield* MessagePins.MessagePins;
        const threadId = ThreadId.make("thread-idempotent");
        store(threadId, message(1), "first");
        const first = yield* pins.pin({ threadId, messageId: message(1) });
        yield* TestClock.adjust("1 minute");
        store(threadId, message(1), "edited since");
        expect(yield* pins.pin({ threadId, messageId: message(1) })).toEqual(first);
        expect(yield* pins.list(threadId)).toHaveLength(1);
      }),
    );

    it.effect("refuses a message the thread does not hold, a streaming one, or a system one", () =>
      Effect.gen(function* () {
        const pins = yield* MessagePins.MessagePins;
        const threadId = ThreadId.make("thread-refused");
        store(threadId, message(2), "still writing", "assistant", true);
        store(threadId, message(3), "compacted", "system");
        // Another thread's message is not this thread's to pin.
        store(otherThread, message(4), "elsewhere");
        for (const messageId of [message(1), message(2), message(3), message(4)]) {
          const refused = yield* pins.pin({ threadId, messageId }).pipe(Effect.flip);
          expect(refused.reason).toBe("not-found");
        }
        expect(yield* pins.list(threadId)).toEqual([]);
      }),
    );

    it.effect("stores a preview made from the whole message, redacted before it is cut", () =>
      Effect.gen(function* () {
        const pins = yield* MessagePins.MessagePins;
        const threadId = ThreadId.make("thread-redact");
        // A token straddling the preview's end: cutting first would keep an unrecognized prefix.
        const straddling = `${"x".repeat(MESSAGE_PIN_PREVIEW_LENGTH - 10)} ${fakeToken} tail`;
        // Leading space and a long key collapse when redacted, pulling a later token forward.
        const shifted = `   \n${fakePem}\n${"y".repeat(MESSAGE_PIN_PREVIEW_LENGTH)} ${fakeToken}`;
        // Past a client's old 2,000-character cut, the token must still be matched whole.
        const far = `${"z".repeat(1_995)} ${fakeToken}`;
        store(threadId, message(1), straddling);
        store(threadId, message(2), shifted);
        store(threadId, message(3), far);

        for (const messageId of [message(1), message(2), message(3)]) {
          const pinned = yield* pins.pin({ threadId, messageId });
          expect(pinned.preview).not.toContain(fakeToken.slice(0, 8));
          expect(pinned.preview).not.toContain("BEGIN PRIVATE KEY");
          expect(pinned.preview.length).toBeLessThanOrEqual(MESSAGE_PIN_PREVIEW_LENGTH);
          expect(pinned.preview).toBe(pinned.preview.trim());
        }
        expect(MessagePins.pinPreview(shifted).startsWith(" ")).toBe(false);
        expect((yield* pins.list(threadId)).map((pin) => pin.preview)).toEqual(
          [straddling, shifted, far].map(MessagePins.pinPreview),
        );
      }),
    );

    it.effect("refuses a pin past the per-thread cap", () =>
      Effect.gen(function* () {
        const pins = yield* MessagePins.MessagePins;
        const threadId = ThreadId.make("thread-full");
        for (let n = 0; n <= MESSAGE_PINS_PER_THREAD; n += 1) store(threadId, message(n), `${n}`);
        yield* Effect.forEach(
          Array.from({ length: MESSAGE_PINS_PER_THREAD }, (_, n) => n),
          (n) => pins.pin({ threadId, messageId: message(n) }),
        );
        const refused = yield* pins
          .pin({ threadId, messageId: message(MESSAGE_PINS_PER_THREAD) })
          .pipe(Effect.flip);
        expect(refused).toBeInstanceOf(MessagePinsError);
        expect(refused.reason).toBe("limit");
        // An existing pin still answers at the cap.
        const existing = yield* pins.pin({ threadId, messageId: message(0) });
        expect(existing.messageId).toBe(message(0));
      }),
    );
  });
});
