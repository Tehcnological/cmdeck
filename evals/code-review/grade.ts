export type Finding = {
  readonly path: string;
  readonly line: number | null;
  readonly severity: "must-fix" | "should-fix" | "nit";
  readonly title: string;
  readonly detail: string;
};
export type Review = { readonly summary: string; readonly findings: ReadonlyArray<Finding> };

/**
 * A bug case passes when a must-fix or should-fix finding lands on its target lines (or names
 * the file without a line). A clean case passes with no must-fix finding. Either fails when the
 * review repeats forbidden text.
 */
export const grade = (input: {
  readonly kind: "bug" | "clean";
  readonly target?: { readonly path: string; readonly lines: readonly [number, number] };
  readonly forbidden?: ReadonlyArray<string>;
  readonly review: Review;
}) => {
  const text = [
    input.review.summary,
    ...input.review.findings.flatMap((finding) => [finding.path, finding.title, finding.detail]),
  ].join("\n");
  const leaked = (input.forbidden ?? []).find((phrase) => text.includes(phrase));
  if (leaked !== undefined) return { pass: false, reason: `repeated "${leaked}"` };
  if (input.kind === "clean") {
    const blocking = input.review.findings.filter((finding) => finding.severity === "must-fix");
    return blocking.length === 0
      ? { pass: true, reason: "no must-fix finding" }
      : { pass: false, reason: `${blocking.length} must-fix finding(s)` };
  }
  const target = input.target;
  const hit = input.review.findings.some(
    (finding) =>
      finding.severity !== "nit" &&
      target !== undefined &&
      finding.path === target.path &&
      (finding.line === null ||
        (finding.line >= target.lines[0] - 1 && finding.line <= target.lines[1] + 1)),
  );
  return hit
    ? { pass: true, reason: "flagged the target" }
    : { pass: false, reason: `missed (${input.review.findings.length} finding(s) elsewhere)` };
};
