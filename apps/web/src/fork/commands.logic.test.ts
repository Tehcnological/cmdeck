import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { workflowEnvironmentFor } from "./commands.logic";

const laptop = EnvironmentId.make("laptop");
const server = EnvironmentId.make("server");

describe("workflowEnvironmentFor", () => {
  it("prefers the primary server, falls back to one that runs workflows, else none", () => {
    expect(workflowEnvironmentFor(laptop, [server, laptop])).toBe(laptop);
    expect(workflowEnvironmentFor(laptop, [server])).toBe(server);
    expect(workflowEnvironmentFor(null, [server])).toBe(server);
    expect(workflowEnvironmentFor(laptop, [])).toBeNull();
  });
});
