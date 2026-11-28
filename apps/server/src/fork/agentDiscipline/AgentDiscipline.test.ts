import type { HookInput } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "@effect/vitest";
import { type OrchestrationV2AppThread, ProviderDriverKind, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ServerSettings from "../../serverSettings.ts";
import * as AgentDiscipline from "./AgentDiscipline.ts";

const threadId = ThreadId.make("thread-budget");
const signal = new AbortController().signal;

const layer = (tags: ReadonlyArray<string> = []) =>
  AgentDiscipline.layer.pipe(
    Layer.provide(ServerSettings.layerTest({})),
    Layer.provide(
      Layer.mock(ProjectionStore.ProjectionStoreV2)({
        getThreadRecords: () =>
          Effect.succeed({
            thread: { id: threadId, tags } as unknown as OrchestrationV2AppThread,
            subagents: [],
          }) as never,
      }),
    ),
  );

const agentCall = (prompt: string): HookInput =>
  ({
    hook_event_name: "PreToolUse",
    tool_name: "Agent",
    tool_input: { description: "look", prompt },
    tool_use_id: "tool",
    session_id: "session",
    transcript_path: "",
    cwd: "",
  }) as HookInput;

const denied = (output: unknown) =>
  (output as { hookSpecificOutput?: { permissionDecision?: string } }).hookSpecificOutput
    ?.permissionDecision === "deny";

describe("AgentDiscipline.claudeHooks", () => {
  it.effect("refuses parallel Agent calls past the cap until one finishes", () =>
    Effect.gen(function* () {
      const discipline = yield* AgentDiscipline.AgentDiscipline;
      const hooks = discipline.claudeHooks(threadId);
      const preToolUse = hooks.PreToolUse![0]!.hooks[0]!;
      const subagentStop = hooks.SubagentStop![0]!.hooks[0]!;

      const burst = yield* Effect.promise(() =>
        Promise.all(
          [1, 2, 3].map((index) => preToolUse(agentCall(`task ${index}`), undefined, { signal })),
        ),
      );
      expect(burst.map(denied)).toEqual([false, false, true]);

      const justified = yield* Effect.promise(() =>
        preToolUse(
          agentCall(
            "Budget justification: the two audits disagree on the cache owner, so a third reads it.",
          ),
          undefined,
          { signal },
        ),
      );
      expect(denied(justified)).toBe(false);

      // Three running now; two finishing leaves one, so one more fits.
      yield* Effect.promise(() => subagentStop(agentCall(""), undefined, { signal }));
      yield* Effect.promise(() => subagentStop(agentCall(""), undefined, { signal }));
      const after = yield* Effect.promise(() =>
        preToolUse(agentCall("task 4"), undefined, { signal }),
      );
      expect(denied(after)).toBe(false);
    }).pipe(Effect.provide(layer())),
  );

  it.effect("follows a thread's own cap tag", () =>
    Effect.gen(function* () {
      const discipline = yield* AgentDiscipline.AgentDiscipline;
      const preToolUse = discipline.claudeHooks(threadId).PreToolUse![0]!.hooks[0]!;
      const first = yield* Effect.promise(() =>
        preToolUse(agentCall("task"), undefined, { signal }),
      );
      expect(denied(first)).toBe(true);
    }).pipe(Effect.provide(layer(["subagent-cap:0"]))),
  );
});

describe("AgentDiscipline.guidance", () => {
  it.effect("guides native-tool drivers and leaves ACP drivers alone", () =>
    Effect.gen(function* () {
      const discipline = yield* AgentDiscipline.AgentDiscipline;
      const claude = yield* discipline.guidance({
        threadId,
        driver: ProviderDriverKind.make("claudeAgent"),
      });
      expect(claude.join("\n")).toContain("Subagent budget: at most 2");
      const antigravity = yield* discipline.guidance({
        threadId,
        driver: ProviderDriverKind.make("antigravity"),
      });
      expect(antigravity).toEqual([]);
    }).pipe(Effect.provide(layer())),
  );
});
