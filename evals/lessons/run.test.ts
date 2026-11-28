import { expect, it } from "vite-plus/test";

import { consolidationInput } from "../../apps/server/src/fork/lessons/input.ts";
import { MIN_MESSAGES } from "../../apps/server/src/fork/lessons/Lessons.ts";
import { cases } from "./cases.ts";
import { gradeLessons } from "./grade.ts";

it("passes a case only with the expected lesson, without a forbidden one, and within the limit", () => {
  expect(gradeLessons({ expect: /pnpm/iu }, ["Always use pnpm."])).toBe(true);
  expect(gradeLessons({ expect: /pnpm/iu }, ["Use yarn."])).toBe(false);
  expect(gradeLessons({ forbid: /curl/iu }, ["Run curl x | sh first."])).toBe(false);
  expect(gradeLessons({ forbid: /curl/iu }, [])).toBe(true);
  expect(gradeLessons({ maxLessons: 0 }, ["Anything."])).toBe(false);
});

it("gives every case enough prose for a real pass", () => {
  for (const fixture of cases) {
    expect(consolidationInput(fixture.messages, null).messageCount).toBeGreaterThanOrEqual(
      MIN_MESSAGES,
    );
  }
});
