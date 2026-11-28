import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { BOT_INSTRUCTIONS_MAX_CHARS, BotCreateInput, botNameProblem } from "./bots.ts";

describe("botNameProblem", () => {
  it.each([["Release Watcher"], ["Triage-bot 2"], ["Café"], ["日報ボット"]])(
    "accepts %j",
    (name) => {
      expect(botNameProblem(name)).toBeUndefined();
    },
  );

  it.each([
    ["", "needs a name"],
    [" Padded", "spaces"],
    ["Padded ", "spaces"],
    ["Two\nlines", "one line"],
    ["Tab\tbed", "one line"],
    ["Zero​width", "hidden"],
    ["Café", "hidden"],
    ["x".repeat(101), "at most 100"],
  ])("refuses %j", (name, reason) => {
    expect(botNameProblem(name)).toContain(reason);
  });
});

describe("BotCreateInput", () => {
  const decode = Schema.decodeUnknownExit(BotCreateInput);
  const base = { name: "Release Watcher", instructions: "", projectId: "project-app" };

  it("caps instructions at half the turn-context block", () => {
    expect(decode({ ...base, instructions: "x".repeat(BOT_INSTRUCTIONS_MAX_CHARS) })._tag).toBe(
      "Success",
    );
    expect(decode({ ...base, instructions: "x".repeat(BOT_INSTRUCTIONS_MAX_CHARS + 1) })._tag).toBe(
      "Failure",
    );
  });

  it("refuses a name the rules refuse", () => {
    expect(decode({ ...base, name: "Two\nlines" })._tag).toBe("Failure");
  });
});
