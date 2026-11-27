import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { EnvironmentId, ProjectId, SourceControlProviderKind } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  type DefaultEnvironmentInput,
  defaultEnvironmentIsUnavailable,
  resolveDefaultEnvironmentProjectRef,
} from "./defaultThreadEnvironment";

const laptop = EnvironmentId.make("laptop");
const server = EnvironmentId.make("server");
const repositoryIdentity = {
  canonicalKey: "github.com/tehcnological/cmdeck",
  locator: {
    source: "git-remote" as const,
    remoteName: "origin",
    remoteUrl: "https://github.com/tehcnological/cmdeck.git",
  },
  provider: SourceControlProviderKind.make("github"),
  owner: "tehcnological",
  name: "cmdeck",
};

const project = (
  environmentId: EnvironmentId,
  id: string,
  overrides: Partial<EnvironmentProject> = {},
): EnvironmentProject => ({
  environmentId,
  id: ProjectId.make(id),
  title: id,
  workspaceRoot: `/${environmentId}/${id}`,
  repositoryIdentity,
  defaultModelSelection: null,
  scripts: [],
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  ...overrides,
});

const onLaptop = project(laptop, "cmdeck");
const onServer = project(server, "cmdeck-checkout");
const laptopOnly = project(laptop, "notes", { repositoryIdentity: null });

const input = (overrides: Partial<DefaultEnvironmentInput> = {}): DefaultEnvironmentInput => ({
  preferredEnvironmentId: server,
  connectedEnvironmentIds: [laptop, server],
  projects: [onLaptop, onServer, laptopOnly],
  groupingSettings: {
    sidebarProjectGroupingMode: "repository",
    sidebarProjectGroupingOverrides: {},
  },
  ...overrides,
});

const laptopRef = scopeProjectRef(laptop, onLaptop.id);

describe("default thread environment", () => {
  it("starts a new thread on the same project on the default environment", () => {
    expect(resolveDefaultEnvironmentProjectRef(laptopRef, input())).toEqual(
      scopeProjectRef(server, onServer.id),
    );
  });

  it("keeps the current environment when there is no default, it is offline, or lacks the project", () => {
    expect(
      resolveDefaultEnvironmentProjectRef(laptopRef, input({ preferredEnvironmentId: null })),
    ).toBe(laptopRef);
    expect(
      resolveDefaultEnvironmentProjectRef(laptopRef, input({ connectedEnvironmentIds: [laptop] })),
    ).toBe(laptopRef);
    const notesRef = scopeProjectRef(laptop, laptopOnly.id);
    expect(resolveDefaultEnvironmentProjectRef(notesRef, input())).toBe(notesRef);
    const archived = { ...onServer, archivedAt: "2026-11-02T00:00:00.000Z" };
    expect(
      resolveDefaultEnvironmentProjectRef(
        laptopRef,
        input({ projects: [onLaptop, archived, laptopOnly] }),
      ),
    ).toBe(laptopRef);
  });

  it("tells the composer when the default environment is offline", () => {
    const draft = { environmentId: laptop };
    const offline = input({ connectedEnvironmentIds: [laptop] });
    expect(defaultEnvironmentIsUnavailable(draft, offline)).toBe(true);
    expect(defaultEnvironmentIsUnavailable(draft, input())).toBe(false);
    expect(defaultEnvironmentIsUnavailable({ environmentId: server }, offline)).toBe(false);
    expect(
      defaultEnvironmentIsUnavailable(draft, { ...offline, preferredEnvironmentId: null }),
    ).toBe(false);
    // A machine the user or load balancing picked is a choice, not a substitute.
    expect(
      defaultEnvironmentIsUnavailable({ ...draft, environmentSelection: "manual" }, offline),
    ).toBe(false);
  });
});
