import { EnvironmentId, ProjectId, ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { lessonChoice, lessonProjects, lessonsModelNote } from "./lessons.logic";

const app = ProjectId.make("project-app");
const other = ProjectId.make("project-other");
const status = {
  model: { instanceId: ProviderInstanceId.make("local-gen"), model: "qwen3", local: true },
  consents: [
    { point: "lessons", projectId: app, source: "remote", grantedAt: "2026-11-28T00:00:00.000Z" },
    {
      point: "memoryNarrowing",
      projectId: other,
      source: "local",
      grantedAt: "2026-11-28T00:00:00.000Z",
    },
  ],
} as const;

describe("lessons settings", () => {
  it("shows a project's lessons consent, and off for any other point's consent", () => {
    expect(lessonChoice(status, app)).toBe("remote");
    expect(lessonChoice(status, other)).toBe("off");
    expect(lessonChoice(null, app)).toBe("off");
  });

  it("says when no model, or only a model off this network, can read the chats", () => {
    expect(lessonsModelNote(status)).toBeNull();
    expect(lessonsModelNote({ ...status, model: null })).toBe("none");
    expect(lessonsModelNote({ ...status, model: { ...status.model, local: false } })).toBe(
      "remote",
    );
  });

  it("lists this environment's real projects by title", () => {
    const here = EnvironmentId.make("here");
    const there = EnvironmentId.make("there");
    const projects = [
      { id: other, title: "zeta", environmentId: here },
      { id: app, title: "alpha", environmentId: here },
      {
        id: ProjectId.make("scratch"),
        title: "Scratch",
        environmentId: here,
        isScratch: true as const,
      },
      { id: ProjectId.make("remote"), title: "beta", environmentId: there },
    ];
    expect(lessonProjects(projects, here).map((project) => project.title)).toEqual([
      "alpha",
      "zeta",
    ]);
  });
});
