import { ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { sharesCheckout } from "./openThreadBeside";

const app = ProjectId.make("project:app");
const docs = ProjectId.make("project:docs");

describe("sharesCheckout", () => {
  it("lets a thread open beside its host only in the same project and checkout", () => {
    expect(
      sharesCheckout(
        { projectId: app, worktreePath: null },
        { projectId: app, worktreePath: null },
      ),
    ).toBe(true);
    expect(
      sharesCheckout(
        { projectId: app, worktreePath: "/wt/a" },
        { projectId: app, worktreePath: "/wt/a" },
      ),
    ).toBe(true);
    // Two main checkouts of different projects have no worktree path either.
    expect(
      sharesCheckout(
        { projectId: docs, worktreePath: null },
        { projectId: app, worktreePath: null },
      ),
    ).toBe(false);
    expect(
      sharesCheckout(
        { projectId: app, worktreePath: "/wt/a" },
        { projectId: app, worktreePath: null },
      ),
    ).toBe(false);
    expect(sharesCheckout(null, { projectId: app, worktreePath: null })).toBe(false);
  });
});
