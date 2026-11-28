import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import type { TurnContextInput, TurnContextSection } from "../memory/TurnContext.ts";
import { activeBotForThread } from "./schema.ts";

/** A live bot's instructions, one entry per line, on every turn in its own thread. */
export const botInstructionsContributor = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  return (input: TurnContextInput): Effect.Effect<TurnContextSection | undefined> =>
    activeBotForThread(sql, input.thread.id).pipe(
      Effect.map((bot) => {
        if (bot === undefined || !input.inject) return undefined;
        const entries = bot.instructions
          .split(/\r?\n/u)
          .map((line) => line.trim())
          .filter((line) => line !== "");
        return entries.length === 0
          ? undefined
          : { title: `Bot "${bot.name}": the user's instructions for this bot`, entries };
      }),
      Effect.catchCause((cause) =>
        Effect.logWarning("Bot instructions unavailable; the turn goes without them.", cause).pipe(
          Effect.as(undefined),
        ),
      ),
      Effect.withSpan("TurnContext.botInstructions"),
    );
});
