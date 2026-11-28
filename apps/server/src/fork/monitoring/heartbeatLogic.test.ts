import { describe, expect, it } from "@effect/vitest";
import { type HeartbeatCheck, parseHeartbeatProbeTarget } from "@t3tools/contracts";

import { heartbeatTransitions, type Observation } from "./heartbeatLogic.ts";

const probe = (up: boolean): Observation => ({
  key: "probe:api",
  kind: "probe",
  label: "API",
  up,
  detail: up ? null : "Answered HTTP 503.",
});

/** Runs passes in order and returns every alert title raised. */
const titlesOver = (passes: ReadonlyArray<ReadonlyArray<Observation>>) => {
  let stored: ReadonlyArray<HeartbeatCheck> = [];
  const titles: Array<string> = [];
  passes.forEach((observed, index) => {
    const next = heartbeatTransitions(stored, observed, 1_000 * (index + 1));
    titles.push(...next.alerts.map((alert) => alert.title));
    stored = next.rows;
  });
  return titles;
};

describe("heartbeatTransitions", () => {
  it("a target that stops answering alerts once, and once when it answers again", () => {
    expect(
      titlesOver([
        [probe(true)],
        [probe(false)],
        [probe(false)],
        [probe(false)],
        [probe(true)],
        [probe(true)],
      ]),
    ).toEqual(["Not responding: API", "Responding again: API"]);
  });

  it("a target down from the first pass alerts once", () => {
    expect(titlesOver([[probe(false)], [probe(false)]])).toEqual(["Not responding: API"]);
  });

  it("a hung turn that ends counts as recovered; a removed probe is dropped quietly", () => {
    const hung: Observation = {
      key: "session:run-1",
      kind: "session",
      label: "Turn in “Fix CI”",
      up: false,
      detail: "No event from the provider for 20 minutes.",
    };
    expect(titlesOver([[hung, probe(false)], [hung, probe(false)], []])).toEqual([
      "Not responding: Turn in “Fix CI”",
      "Not responding: API",
      "Responding again: Turn in “Fix CI”",
    ]);
  });

  it("keeps when a state began and ids each alert by it, so a resend is one message", () => {
    const first = heartbeatTransitions([], [probe(false)], 1_000);
    const second = heartbeatTransitions(first.rows, [probe(false)], 2_000);
    expect(second.rows[0]).toMatchObject({ since: 1_000, checkedAt: 2_000 });
    expect(first.alerts[0]?.id).toBe("heartbeat:probe:api:down:1000");
  });
});

describe("parseHeartbeatProbeTarget", () => {
  it.each([
    [
      "https://status.example.com/health",
      { kind: "http", url: "https://status.example.com/health" },
    ],
    ["http://192.168.5.20:8080", { kind: "http", url: "http://192.168.5.20:8080/" }],
    ["tcp://db.internal:5432", { kind: "tcp", host: "db.internal", port: 5432 }],
    ["nas.local:22", { kind: "tcp", host: "nas.local", port: 22 }],
    ["tcp://[::1]:6379", { kind: "tcp", host: "::1", port: 6379 }],
  ])("%s is checked", (target, expected) => {
    expect(parseHeartbeatProbeTarget(target)).toEqual(expected);
  });

  it.each([
    "file:///etc/passwd",
    "data:text/plain,hello",
    "ftp://example.com",
    "https://user:secret@example.com",
    "nas.local:70000",
    "not a target",
  ])("%s is refused", (target) => {
    expect(typeof parseHeartbeatProbeTarget(target)).toBe("string");
  });
});
