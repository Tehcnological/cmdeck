import { DEFAULT_SERVER_SETTINGS, type OrchestrationV2TurnItem } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { EnvironmentToolkit } from "../../mcp/toolkits/environment/tools.ts";
import { makeManagedSettings } from "../../policy/managedSettings.ts";
import { approvalFacts, gateAnswer } from "./ApprovalGate.ts";

type ApprovalItem = Extract<OrchestrationV2TurnItem, { readonly type: "approval_request" }>;

const at = DEFAULT_SERVER_SETTINGS.cmdeck.approvalPolicy;

describe("where approval rules come from", () => {
  it("lets a managed policy set and lock the rules", () => {
    const rules = { ...at, protectedPaths: ["~/.aws"] };
    const managed = makeManagedSettings({
      "cmdeck.approvalPolicy": { value: rules, locked: true },
    });
    if (managed._tag !== "Valid") throw new Error(managed.reason);
    const applied = managed.settings.applyLocks(DEFAULT_SERVER_SETTINGS);
    expect(applied.cmdeck.approvalPolicy.protectedPaths).toEqual(["~/.aws"]);
    const loosened = {
      ...applied,
      cmdeck: { ...applied.cmdeck, approvalPolicy: at },
    };
    expect(
      managed.settings.vetWrite(applied, loosened, { cmdeck: { approvalPolicy: at } })._tag,
    ).toBe("Locked");
  });

  it("gives MCP tools no way to write them", () => {
    // The environment preferences tool is the only MCP tool that writes server settings.
    const fields = Object.keys(
      EnvironmentToolkit.tools.t3_environment_preferences_update.parametersSchema.fields,
    );
    expect(fields).not.toContain("cmdeck");
  });
});

describe("approval facts", () => {
  // The facts read only these fields, so the fixtures carry nothing else.
  const tool = (fields: Readonly<Record<string, unknown>>) =>
    fields as unknown as OrchestrationV2TurnItem;
  const card = (requestKind: ApprovalItem["requestKind"], prompt?: string) =>
    ({ type: "approval_request", requestKind, prompt }) as ApprovalItem;

  it("takes the command from the tool call over the card's prompt", () => {
    const facts = approvalFacts(
      "command",
      card("command", "List the files"),
      [tool({ type: "command_execution", input: "cat ~/.ssh/id_rsa" })],
      "/work/app",
    );
    expect(facts.command).toBe("cat ~/.ssh/id_rsa");
    expect(facts.texts).toEqual(["List the files", "cat ~/.ssh/id_rsa"]);
  });

  it("falls back to a command card's prompt when the tool call is not stored yet", () => {
    expect(approvalFacts("command", card("command", "rm -rf /"), [], undefined).command).toBe(
      "rm -rf /",
    );
    expect(
      approvalFacts("permission", card("permission", "Use WebFetch"), [], undefined).command,
    ).toBe(undefined);
  });

  it("collects the tool name and the paths a file change writes", () => {
    const facts = approvalFacts(
      "file-change",
      card("file-change"),
      [
        tool({
          type: "dynamic_tool",
          toolName: "Write",
          input: { file_path: "/etc/hosts", content: "x" },
        }),
        tool({
          type: "file_change",
          fileName: "a.ts",
          changes: [{ operation: "rename", path: "b.ts", oldPath: "a.ts" }],
        }),
      ],
      "/work/app",
    );
    expect(facts.toolName).toBe("Write");
    expect(facts.writePaths).toEqual(["/etc/hosts", "a.ts", "b.ts", "a.ts"]);
  });
});

describe("answers to a judged approval", () => {
  const deny = {
    decision: "deny",
    rule: "denyTools: Bash",
    reason: "the tool Bash is denied",
  } as const;
  const allow = { decision: "allow" } as const;

  it.each(["accept", "acceptForSession", "acceptAlways"] as const)(
    "turns %s into a decline when the rules deny it",
    (decision) => {
      expect(gateAnswer({ decision }, deny, true)).toEqual({
        decision: "decline",
        feedback: expect.stringContaining("the tool Bash is denied"),
      });
      expect(gateAnswer({ decision }, deny, false)).toEqual({ decision: "decline" });
    },
  );

  it("narrows a standing grant to this request while rules apply", () => {
    expect(gateAnswer({ decision: "acceptForSession" }, allow, false)).toEqual({
      decision: "accept",
    });
    expect(gateAnswer({ decision: "accept" }, allow, false)).toEqual({ decision: "accept" });
  });

  it("leaves declines and cancels alone", () => {
    const declined = { decision: "decline", feedback: "not now" } as const;
    expect(gateAnswer(declined, deny, true)).toBe(declined);
    expect(gateAnswer({ decision: "cancel" }, deny, true)).toEqual({ decision: "cancel" });
  });
});
