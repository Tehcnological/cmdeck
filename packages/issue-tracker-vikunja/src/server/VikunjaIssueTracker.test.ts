import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { IssueTrackerError } from "@t3tools/source-control-core/server/IssueTracker";

import {
  normalizeVikunjaBaseUrl,
  parseVikunjaIssueUrl,
  vikunjaTaskUrl,
} from "../shared/issueUrl.ts";
import * as VikunjaApi from "./VikunjaApi.ts";
import * as VikunjaIssueTracker from "./VikunjaIssueTracker.ts";

const BASE_URL = "https://vikunja.example.com";

const ALICE: VikunjaApi.VikunjaUser = {
  id: 1,
  username: "alice",
  name: "Alice Doe",
  email: "alice@example.com",
};

const BOB: VikunjaApi.VikunjaUser = {
  id: 2,
  username: "bob",
  name: "Bob Smith",
  email: "bob@example.com",
};

const SAMPLE_TASK: VikunjaApi.VikunjaTask = {
  id: 42,
  project_id: 7,
  identifier: "ENG-42",
  title: "Ship Vikunja integration",
  description: "Support self-hosted Vikunja instances.",
  done: false,
  done_at: "0001-01-01T00:00:00Z",
  created: "2026-10-01T10:00:00Z",
  updated: "2026-10-02T12:00:00Z",
  created_by: ALICE,
  assignees: [BOB],
  labels: [{ id: 10, title: "backend", hex_color: "2563eb" }],
  bucket_id: 101,
  comment_count: 1,
  reactions: { "👍": [ALICE, BOB] },
};

function makeFakeApi(overrides: Partial<VikunjaApi.VikunjaApi["Service"]> = {}) {
  const unsupported = (name: string) => () =>
    Effect.fail(
      new IssueTrackerError({
        tracker: VikunjaApi.KIND,
        operation: name,
        reason: "failed",
        detail: `unexpected call to ${name}`,
      }),
    );

  const service: VikunjaApi.VikunjaApi["Service"] = {
    resolveBaseUrl: () => Effect.succeed(BASE_URL),
    viewer: () => Effect.succeed({ user: ALICE, baseUrl: BASE_URL }),
    listProjects: () =>
      Effect.succeed([
        { id: 7, title: "Engineering", identifier: "ENG", is_archived: false },
        { id: 8, title: "Archived", identifier: "OLD", is_archived: true },
      ]),
    getProject: () => Effect.succeed({ id: 7, title: "Engineering", identifier: "ENG" }),
    listProjectViews: () =>
      Effect.succeed([
        { id: 11, view_kind: "list", project_id: 7 },
        { id: 12, view_kind: "kanban", project_id: 7, done_bucket_id: 102 },
      ]),
    listBuckets: () =>
      Effect.succeed([
        { id: 101, title: "In Progress", position: 1 },
        { id: 102, title: "Done", position: 2 },
      ]),
    listProjectUsers: () => Effect.succeed([ALICE, BOB]),
    listLabels: () =>
      Effect.succeed({
        labels: [
          { id: 10, title: "backend", hex_color: "2563eb", description: "Server work" },
          { id: 11, title: "urgent", hex_color: "#dc2626", description: null },
        ],
        truncated: false,
      }),
    listTasks: () => Effect.succeed({ tasks: [SAMPLE_TASK], totalPages: 2 }),
    getTask: () => Effect.succeed(SAMPLE_TASK),
    createTask: (_projectId, input) =>
      Effect.succeed({
        ...SAMPLE_TASK,
        id: 99,
        identifier: "",
        title: input.title,
        description: input.description,
      }),
    updateTask: () => Effect.succeed(SAMPLE_TASK),
    listComments: () =>
      Effect.succeed([
        {
          id: 501,
          comment: "Looks great!",
          author: BOB,
          created: "2026-10-02T11:00:00Z",
          reactions: { "🚀": [ALICE] },
        },
      ]),
    createComment: unsupported("createComment"),
    setTaskLabels: () => Effect.void,
    setTaskAssignees: () => Effect.void,
    addReaction: () => Effect.void,
    deleteReaction: () => Effect.void,
    ...overrides,
  };

  return Layer.succeed(VikunjaApi.VikunjaApi, VikunjaApi.VikunjaApi.of(service));
}

describe("Vikunja URL helpers", () => {
  it("normalizes self-hosted base URLs and strips trailing /api/v1", () => {
    expect(normalizeVikunjaBaseUrl("https://Vikunja.Example.com/api/v1/")).toBe(
      "https://vikunja.example.com",
    );
    expect(normalizeVikunjaBaseUrl("http://localhost:3456/subpath/")).toBe(
      "http://localhost:3456/subpath",
    );
    expect(normalizeVikunjaBaseUrl("https://user:pass@vikunja.example.com")).toBeNull();
    expect(normalizeVikunjaBaseUrl("ftp://vikunja.example.com")).toBeNull();
  });

  it("parses task URLs only for the connected instance origin and base path", () => {
    expect(parseVikunjaIssueUrl(new URL("https://vikunja.example.com/tasks/42"), BASE_URL)).toEqual(
      {
        host: "vikunja.example.com",
        workspace: BASE_URL,
        scope: "",
        key: "42",
      },
    );
    expect(
      parseVikunjaIssueUrl(new URL("https://other.example.com/tasks/42"), BASE_URL),
    ).toBeNull();
    expect(
      parseVikunjaIssueUrl(
        new URL("https://example.com/vikunja/tasks/7"),
        "https://example.com/vikunja",
      ),
    ).toMatchObject({ host: "example.com", key: "7" });
    expect(vikunjaTaskUrl("https://vikunja.example.com/", 42)).toBe(
      "https://vikunja.example.com/tasks/42",
    );
  });
});

describe("VikunjaIssueTracker", () => {
  it.effect("probes credentials and returns non-archived projects as scopes", () =>
    Effect.gen(function* () {
      const tracker = yield* VikunjaIssueTracker.make;
      const result = yield* tracker.probeCredential("tk_secret", "https://vikunja.example.com/");
      expect(result).toEqual({
        account: "alice",
        host: "vikunja.example.com",
        baseUrl: BASE_URL,
        workspace: BASE_URL,
        scopes: [{ key: "7", name: "Engineering" }],
      });
    }).pipe(Effect.provide(makeFakeApi())),
  );

  it.effect(
    "lists tasks with Kanban state mapping, pagination cursor, and label/assignee filters",
    () =>
      Effect.gen(function* () {
        const tracker = yield* VikunjaIssueTracker.make;
        const page = yield* tracker.listIssues({
          cwd: "/repo",
          host: "vikunja.example.com",
          scope: "7",
          involvement: "all",
          state: "open",
          limit: 20,
          sort: "updated",
          labels: ["BACKEND"],
          assignee: "bob",
        });
        expect(page.nextCursor).toBe("2");
        expect(page.items).toHaveLength(1);
        expect(page.items[0]).toMatchObject({
          key: "42",
          displayKey: "ENG-42",
          title: "Ship Vikunja integration",
          url: "https://vikunja.example.com/tasks/42",
          state: { category: "open", name: "In Progress" },
          closedAt: null,
          labels: [{ name: "backend", color: "#2563eb" }],
        });
      }).pipe(Effect.provide(makeFakeApi())),
  );

  it.effect("reads task detail with Kanban states, comments, and reactions", () =>
    Effect.gen(function* () {
      const tracker = yield* VikunjaIssueTracker.make;
      const detail = yield* tracker.getIssue({
        cwd: "/repo",
        host: "vikunja.example.com",
        scope: "7",
        key: "42",
      });
      expect(detail.states).toEqual([
        { category: "open", name: "In Progress" },
        { category: "closed", name: "Done", closeReason: "completed" },
      ]);
      expect(detail.reactions).toEqual([
        { content: "thumbs-up", count: 2, actors: ["bob"], viewerHasReacted: true },
      ]);
      expect(detail.comments).toHaveLength(1);
      expect(detail.comments[0]?.body).toBe("Looks great!");
      expect(detail.comments[0]?.reactions).toEqual([
        { content: "rocket", count: 1, actors: [], viewerHasReacted: true },
      ]);
    }).pipe(Effect.provide(makeFakeApi())),
  );

  it.effect("creates a task and attaches resolved labels and assignees", () =>
    Effect.gen(function* () {
      const setLabels: number[][] = [];
      const setAssignees: number[][] = [];
      const tracker = yield* VikunjaIssueTracker.make.pipe(
        Effect.provide(
          makeFakeApi({
            setTaskLabels: (_id, ids) =>
              Effect.sync(() => {
                setLabels.push([...ids]);
              }),
            setTaskAssignees: (_id, ids) =>
              Effect.sync(() => {
                setAssignees.push([...ids]);
              }),
          }),
        ),
      );
      const created = yield* tracker.create!({
        cwd: "/repo",
        host: "vikunja.example.com",
        scope: "7",
        title: "New ticket",
        body: "Details",
        labels: ["backend", "urgent"],
        assignees: ["bob"],
      });
      expect(created).toEqual({
        key: "99",
        displayKey: "#99",
        url: "https://vikunja.example.com/tasks/99",
      });
      expect(setLabels).toEqual([[10, 11]]);
      expect(setAssignees).toEqual([[2]]);
    }),
  );

  it.effect("moves a task to the Kanban Done bucket and marks done=true", () =>
    Effect.gen(function* () {
      const updates: Record<string, unknown>[] = [];
      const tracker = yield* VikunjaIssueTracker.make.pipe(
        Effect.provide(
          makeFakeApi({
            updateTask: (_id, payload) =>
              Effect.sync(() => {
                updates.push(payload);
                return { ...SAMPLE_TASK, done: true, bucket_id: 102 };
              }),
          }),
        ),
      );
      yield* tracker.setState!({
        cwd: "/repo",
        host: "vikunja.example.com",
        scope: "7",
        key: "42",
        state: "Done",
      });
      expect(updates).toHaveLength(1);
      expect(updates[0]).toMatchObject({ id: 42, done: true, bucket_id: 102 });
    }),
  );
});
