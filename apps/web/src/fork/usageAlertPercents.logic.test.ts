import { describe, expect, it } from "vite-plus/test";

import { formatUsageAlertPercents, parseUsageAlertPercents } from "./usageAlertPercents.logic";

describe("parseUsageAlertPercents", () => {
  it.each([
    ["80", [80]],
    ["95, 50 80", [50, 80, 95]],
    ["80%, 80", [80]],
    ["", []],
    ["  ", []],
    ["1,100", [1, 100]],
  ])("reads %j", (text, expected) => {
    expect(parseUsageAlertPercents(text)).toEqual(expected);
  });

  it.each(["0", "101", "79.5", "-5", "eighty", "80;90"])("refuses %j", (text) => {
    expect(parseUsageAlertPercents(text)).toBeNull();
  });

  it("round-trips what it formats", () => {
    expect(parseUsageAlertPercents(formatUsageAlertPercents([50, 80]))).toEqual([50, 80]);
  });
});
