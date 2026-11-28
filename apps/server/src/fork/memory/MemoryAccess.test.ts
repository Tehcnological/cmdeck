import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import * as MemoryAccess from "./MemoryAccess.ts";

const threadId = ThreadId.make("thread-a");
const base: MemoryAccess.MemoryThreadContext = {
  threadId,
  projectId: "project-a",
  repoKey: "github.com/acme/app",
  botId: null,
  mode: "persistent",
};
const bot = { ...base, botId: "bot-1" };

describe("MemoryAccess.allows", () => {
  it.each([
    ["persistent reads", base, "read", undefined, true],
    ["persistent writes", base, "write", undefined, true],
    ["incognito reads", { ...base, mode: "incognito" }, "read", undefined, true],
    ["incognito refuses writes", { ...base, mode: "incognito" }, "write", undefined, false],
    ["temporary refuses reads", { ...base, mode: "temporary" }, "read", undefined, false],
    ["temporary refuses writes", { ...base, mode: "temporary" }, "write", undefined, false],
    ["global", base, "read", "global", true],
    ["its own thread", base, "read", "thread:thread-a", true],
    ["another thread", base, "read", "thread:thread-b", false],
    ["its project", base, "write", "project:project-a", true],
    ["another project", base, "read", "project:project-b", false],
    ["its repository", base, "read", "repo:github.com/acme/app", true],
    ["another repository", base, "read", "repo:github.com/acme/other", false],
    ["a bot scope outside the bot's thread", base, "read", "bot:bot-1", false],
    ["its bot scope in the bot's thread", bot, "write", "bot:bot-1", true],
    ["another bot's scope", bot, "read", "bot:bot-2", false],
    ["an unreadable thread", MemoryAccess.restrictedContext(threadId), "read", "global", false],
  ] as const)("%s", (_name, context, access, scope, expected) => {
    expect(MemoryAccess.allows(context, access, scope)).toBe(expected);
  });

  it("lists no readable scopes for a temporary thread", () => {
    expect(MemoryAccess.readableScopes({ ...base, mode: "temporary" })).toEqual([]);
    expect(MemoryAccess.readableScopes({ ...base, projectId: null, repoKey: null })).toEqual([
      "global",
      "thread:thread-a",
    ]);
  });
});
