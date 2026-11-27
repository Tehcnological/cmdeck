import { expect, it } from "@effect/vitest";

import { redactLine } from "./redactingLogger.ts";

it("redacts a labelled value even when the logger coloured its label", () => {
  const secret = ["hunter", "2-long-enough"].join("");
  const coloured = `\x1b[1m\x1b[37mpassword:\x1b[0m ${secret}`;
  expect(redactLine([coloured])).toBe("password: [redacted]");
  expect(redactLine(["\x1b[32mready\x1b[0m"])).toBe("\x1b[32mready\x1b[0m");
});
