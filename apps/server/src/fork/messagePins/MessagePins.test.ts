import { describe, expect, it } from "@effect/vitest";
import {
  MESSAGE_PIN_PREVIEW_LENGTH,
  MESSAGE_PINS_PER_THREAD,
  MessageId,
  MessagePinsError,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import * as Sqlite from "../../persistence/Sqlite.ts";
import * as MessagePins from "./MessagePins.ts";

// Built from parts so no literal token sits in the source.
const fakeToken = ["gh", "p_", "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8"].join("");
const thread = ThreadId.make("thread-pins");
const otherThread = ThreadId.make("thread-other");
const message = (n: number) => MessageId.make(`message-${n}`);

describe("MessagePins", () => {
  it.layer(MessagePins.layer.pipe(Layer.provideMerge(Sqlite.layerMemory)))((it) => {
    it.effect("pins, lists oldest first per thread, and unpins", () =>
      Effect.gen(function* () {
        const pins = yield* MessagePins.MessagePins;
        yield* pins.pin({ threadId: thread, messageId: message(1), role: "user", preview: "a" });
        yield* TestClock.adjust("1 second");
        yield* pins.pin({
          threadId: thread,
          messageId: message(2),
          role: "assistant",
          preview: "b",
        });
        yield* pins.pin({
          threadId: otherThread,
          messageId: message(3),
          role: "user",
          preview: "c",
        });

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
        const first = yield* pins.pin({
          threadId,
          messageId: message(1),
          role: "user",
          preview: "first",
        });
        yield* TestClock.adjust("1 minute");
        const again = yield* pins.pin({
          threadId,
          messageId: message(1),
          role: "user",
          preview: "second",
        });
        expect(again).toEqual(first);
        expect(yield* pins.list(threadId)).toHaveLength(1);
      }),
    );

    it.effect("redacts the preview before cutting it", () =>
      Effect.gen(function* () {
        const pins = yield* MessagePins.MessagePins;
        const threadId = ThreadId.make("thread-redact");
        // The token straddles the cut, so cutting first would leave an unrecognized fragment.
        const text = `${"x".repeat(MESSAGE_PIN_PREVIEW_LENGTH - 10)} ${fakeToken} tail`;
        const pinned = yield* pins.pin({
          threadId,
          messageId: message(1),
          role: "user",
          preview: text,
        });
        expect(pinned.preview).not.toContain(fakeToken.slice(0, 8));
        expect(pinned.preview.length).toBeLessThanOrEqual(MESSAGE_PIN_PREVIEW_LENGTH);
        expect((yield* pins.list(threadId))[0]?.preview).toBe(pinned.preview);
      }),
    );

    it.effect("refuses a pin past the per-thread cap", () =>
      Effect.gen(function* () {
        const pins = yield* MessagePins.MessagePins;
        const threadId = ThreadId.make("thread-full");
        yield* Effect.forEach(
          Array.from({ length: MESSAGE_PINS_PER_THREAD }, (_, n) => n),
          (n) => pins.pin({ threadId, messageId: message(n), role: "user", preview: `${n}` }),
        );
        const refused = yield* pins
          .pin({ threadId, messageId: message(999), role: "user", preview: "over" })
          .pipe(Effect.flip);
        expect(refused).toBeInstanceOf(MessagePinsError);
        expect(refused.reason).toBe("limit");
        // An existing pin still answers at the cap.
        const existing = yield* pins.pin({
          threadId,
          messageId: message(0),
          role: "user",
          preview: "0",
        });
        expect(existing.messageId).toBe(message(0));
      }),
    );
  });
});
