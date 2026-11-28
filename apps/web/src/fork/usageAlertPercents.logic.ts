export const DEFAULT_USAGE_ALERT_PERCENTS: ReadonlyArray<number> = [80];

export function formatUsageAlertPercents(percents: ReadonlyArray<number>): string {
  return percents.join(", ");
}

/**
 * Whole percentages from 1 to 100, separated by commas or spaces, with an optional `%` each.
 * Sorted without repeats; empty text is an empty list. `null` when any entry is not one.
 */
export function parseUsageAlertPercents(text: string): ReadonlyArray<number> | null {
  const entries = text
    .split(/[\s,]+/)
    .map((entry) => entry.replace(/%$/, ""))
    .filter((entry) => entry !== "");
  const percents: number[] = [];
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) return null;
    const percent = Number(entry);
    if (percent < 1 || percent > 100) return null;
    percents.push(percent);
  }
  return [...new Set(percents)].toSorted((a, b) => a - b);
}

export function sameUsageAlertPercents(a: ReadonlyArray<number>, b: ReadonlyArray<number>) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
