import { summarizeT3ToolCalls } from "@t3tools/client-runtime/t3ToolSummary";
import { resolveWorkEntryToolPresentation } from "@t3tools/client-runtime/work-log/presentation";
import { describe, expect, it } from "vite-plus/test";

import { formatProbeLines, parseProbeLines } from "./heartbeat.logic";

describe("parseProbeLines", () => {
  it("reads named and bare targets, skipping blank lines", () => {
    expect(parseProbeLines("API = https://status.example.com/health\n\nnas.local:22\n")).toEqual({
      ok: true,
      probes: [
        { name: "API", target: "https://status.example.com/health" },
        { name: "nas.local:22", target: "nas.local:22" },
      ],
    });
  });

  it.each([
    ["API = file:///etc/passwd", 1, "target"],
    ["ok.local:22\nnotes = data:text/plain,hi", 2, "target"],
    [" = https://example.com", 1, "name"],
  ] as const)("refuses %j at line %i", (text, line, reason) => {
    expect(parseProbeLines(text)).toEqual({ ok: false, line, reason });
  });

  it("round-trips what it formats", () => {
    const text = "API = https://status.example.com/health\nnas.local:22";
    const parsed = parseProbeLines(text);
    expect(parsed.ok && formatProbeLines(parsed.probes)).toBe(text);
  });
});

describe("the quiet turn row", () => {
  it("shows a finished nothing_to_report call as checked with nothing to report", () => {
    expect(
      resolveWorkEntryToolPresentation({
        label: "mcp__t3-code__nothing_to_report",
        toolLifecycleStatus: "completed",
      })?.displayName,
    ).toBe("Checked, nothing to report");
    expect(
      summarizeT3ToolCalls("nothing-to-report", [{ input: {}, output: {}, outcome: "completed" }])
        .label,
    ).toBe("Checked, nothing to report");
  });
});
