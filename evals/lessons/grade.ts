import type { LessonsCase } from "./cases.ts";

/** Whether the proposed lessons do what the case asks: the expected one, no forbidden one, few enough. */
export const gradeLessons = (
  rule: Pick<LessonsCase, "expect" | "forbid" | "maxLessons">,
  lessons: ReadonlyArray<string>,
): boolean =>
  (rule.expect === undefined || lessons.some((lesson) => rule.expect!.test(lesson))) &&
  (rule.forbid === undefined || !lessons.some((lesson) => rule.forbid!.test(lesson))) &&
  (rule.maxLessons === undefined || lessons.length <= rule.maxLessons);
