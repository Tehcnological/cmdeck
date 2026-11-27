import { expect, it } from "@effect/vitest";

import { redactLine } from "./redactingLogger.ts";

it("redacts a labelled value even when the logger coloured its label", () => {
  const secret = ["hunter", "2-long-enough"].join("");
  const coloured = `\x1b[1m\x1b[37mpassword:\x1b[0m ${secret}`;
  expect(redactLine([coloured])).toBe("password: [redacted]");
  expect(redactLine(["\x1b[32mready\x1b[0m"])).toBe("\x1b[32mready\x1b[0m");
});

it("redacts a long multiline secret that inspect would split into joined pieces", () => {
  const password = `${"a".repeat(100)}\n${"sensitive-tail".repeat(10)}`;
  const line = redactLine([{ password, user: "ana" }]);
  expect(line).not.toContain("sensitive-tail");
  expect(line).toContain("user: 'ana'");
});

it("redacts a whole annotation value that the logger passes after its label", () => {
  expect(redactLine(["password:", "correct horse battery staple"])).toBe('password: "[redacted]"');
  expect(redactLine(["user:", "ana"])).toBe("user: ana");
});
