import { ScheduledTaskId, type ScheduledTaskCheckState } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  checkDraftFrom,
  checkFromDraft,
  checkStatus,
  draftMatches,
} from "./scheduledTaskCheck.logic";

const stored: ScheduledTaskCheckState = {
  taskId: ScheduledTaskId.make("scheduled-task:a"),
  interpreter: "node",
  script: "process.exit(10)",
  timeoutSeconds: 60,
  reportOnly: false,
  sha256: "abc",
  approved: false,
};

describe("checkStatus", () => {
  it("tells none, approved and waiting apart", () => {
    expect(checkStatus(undefined)).toBe("none");
    expect(checkStatus(stored)).toBe("pending");
    expect(checkStatus({ ...stored, approved: true })).toBe("approved");
  });
});

describe("checkFromDraft", () => {
  it("saves a filled draft with its timeout as a number", () => {
    expect(checkFromDraft({ ...checkDraftFrom(stored), timeoutSeconds: " 90 " })).toEqual({
      check: {
        interpreter: "node",
        script: "process.exit(10)",
        timeoutSeconds: 90,
        reportOnly: false,
      },
    });
  });

  it("refuses an empty script, an overlong one, and a timeout out of range", () => {
    const draft = checkDraftFrom(undefined);
    expect(checkFromDraft(draft)).toEqual({ problem: "empty" });
    expect(checkFromDraft({ ...draft, script: "x".repeat(20_001) })).toEqual({
      problem: "tooLong",
    });
    for (const timeoutSeconds of ["4", "1801", "1.5", "soon"]) {
      expect(checkFromDraft({ ...draft, script: "exit 10", timeoutSeconds })).toEqual({
        problem: "timeout",
      });
    }
  });
});

describe("draftMatches", () => {
  it("is true only while the draft shows the stored check, so the dialog approves what was read", () => {
    const draft = checkDraftFrom(stored);
    expect(draftMatches(draft, stored)).toBe(true);
    expect(draftMatches({ ...draft, script: `${draft.script};` }, stored)).toBe(false);
    expect(draftMatches({ ...draft, interpreter: "bash" }, stored)).toBe(false);
    expect(draftMatches(draft, undefined)).toBe(false);
  });
});
