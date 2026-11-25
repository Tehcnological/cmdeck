/**
 * Vikunja REST API v1 client, authenticated with a Bearer API token and pointed at the user's
 * self-hosted Vikunja instance URL saved in Settings.
 */
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/http";
import { IssueTrackerError } from "@t3tools/source-control-core/server/IssueTracker";
import * as IssueTrackerHost from "@t3tools/source-control-core/server/IssueTrackerHost";

import { normalizeVikunjaBaseUrl, VIKUNJA_KIND } from "../shared/issueUrl.ts";

export const KIND = VIKUNJA_KIND;

const VikunjaApiConfig = Config.all({
  fallbackBaseUrl: Config.String("T3CODE_VIKUNJA_URL").pipe(Config.withDefault("")),
});

export const VikunjaUserSchema = Schema.Struct({
  id: Schema.Number,
  username: Schema.optional(Schema.NullOr(Schema.String)),
  name: Schema.optional(Schema.NullOr(Schema.String)),
  email: Schema.optional(Schema.NullOr(Schema.String)),
});
export type VikunjaUser = typeof VikunjaUserSchema.Type;

export const VikunjaLabelSchema = Schema.Struct({
  id: Schema.Number,
  title: Schema.String,
  description: Schema.optional(Schema.NullOr(Schema.String)),
  hex_color: Schema.optional(Schema.NullOr(Schema.String)),
});
export type VikunjaLabel = typeof VikunjaLabelSchema.Type;

export const VikunjaProjectViewSchema = Schema.Struct({
  id: Schema.Number,
  title: Schema.optional(Schema.String),
  project_id: Schema.optional(Schema.Number),
  view_kind: Schema.String,
  default_bucket_id: Schema.optional(Schema.NullOr(Schema.Number)),
  done_bucket_id: Schema.optional(Schema.NullOr(Schema.Number)),
});
export type VikunjaProjectView = typeof VikunjaProjectViewSchema.Type;

export const VikunjaBucketSchema = Schema.Struct({
  id: Schema.Number,
  title: Schema.String,
  position: Schema.optional(Schema.Number),
  project_view_id: Schema.optional(Schema.Number),
});
export type VikunjaBucket = typeof VikunjaBucketSchema.Type;

export const VikunjaProjectSchema = Schema.Struct({
  id: Schema.Number,
  title: Schema.String,
  identifier: Schema.optional(Schema.NullOr(Schema.String)),
  description: Schema.optional(Schema.NullOr(Schema.String)),
  is_archived: Schema.optional(Schema.Boolean),
  views: Schema.optional(Schema.NullOr(Schema.Array(VikunjaProjectViewSchema))),
});
export type VikunjaProject = typeof VikunjaProjectSchema.Type;

export const VikunjaReactionMapSchema = Schema.Record(
  Schema.String,
  Schema.Array(VikunjaUserSchema),
);
export type VikunjaReactionMap = typeof VikunjaReactionMapSchema.Type;

export const VikunjaTaskCommentSchema = Schema.Struct({
  id: Schema.Number,
  comment: Schema.String,
  author: Schema.optional(Schema.NullOr(VikunjaUserSchema)),
  created: Schema.optional(Schema.NullOr(Schema.String)),
  updated: Schema.optional(Schema.NullOr(Schema.String)),
  reactions: Schema.optional(Schema.NullOr(VikunjaReactionMapSchema)),
});
export type VikunjaTaskComment = typeof VikunjaTaskCommentSchema.Type;

export const VikunjaTaskSchema = Schema.Struct({
  id: Schema.Number,
  project_id: Schema.Number,
  identifier: Schema.optional(Schema.NullOr(Schema.String)),
  index: Schema.optional(Schema.Number),
  title: Schema.String,
  description: Schema.optional(Schema.NullOr(Schema.String)),
  done: Schema.optional(Schema.Boolean),
  done_at: Schema.optional(Schema.NullOr(Schema.String)),
  created: Schema.optional(Schema.NullOr(Schema.String)),
  updated: Schema.optional(Schema.NullOr(Schema.String)),
  created_by: Schema.optional(Schema.NullOr(VikunjaUserSchema)),
  assignees: Schema.optional(Schema.NullOr(Schema.Array(VikunjaUserSchema))),
  labels: Schema.optional(Schema.NullOr(Schema.Array(VikunjaLabelSchema))),
  bucket_id: Schema.optional(Schema.NullOr(Schema.Number)),
  comment_count: Schema.optional(Schema.NullOr(Schema.Number)),
  reactions: Schema.optional(Schema.NullOr(VikunjaReactionMapSchema)),
  priority: Schema.optional(Schema.NullOr(Schema.Number)),
  due_date: Schema.optional(Schema.NullOr(Schema.String)),
  start_date: Schema.optional(Schema.NullOr(Schema.String)),
  end_date: Schema.optional(Schema.NullOr(Schema.String)),
  percent_done: Schema.optional(Schema.NullOr(Schema.Number)),
  hex_color: Schema.optional(Schema.NullOr(Schema.String)),
});
export type VikunjaTask = typeof VikunjaTaskSchema.Type;

export interface VikunjaCredentials {
  readonly token: string;
  readonly baseUrl: string;
}

export class VikunjaApi extends Context.Service<
  VikunjaApi,
  {
    readonly resolveBaseUrl: () => Effect.Effect<string | null, IssueTrackerError>;
    readonly viewer: (
      credentials?: VikunjaCredentials,
    ) => Effect.Effect<{ readonly user: VikunjaUser; readonly baseUrl: string }, IssueTrackerError>;
    readonly listProjects: (
      credentials?: VikunjaCredentials,
    ) => Effect.Effect<ReadonlyArray<VikunjaProject>, IssueTrackerError>;
    readonly getProject: (
      projectId: number,
    ) => Effect.Effect<VikunjaProject | null, IssueTrackerError>;
    readonly listProjectViews: (
      projectId: number,
    ) => Effect.Effect<ReadonlyArray<VikunjaProjectView>, IssueTrackerError>;
    readonly listBuckets: (
      projectId: number,
      viewId: number,
    ) => Effect.Effect<ReadonlyArray<VikunjaBucket>, IssueTrackerError>;
    readonly listProjectUsers: (
      projectId: number,
    ) => Effect.Effect<ReadonlyArray<VikunjaUser>, IssueTrackerError>;
    readonly listLabels: () => Effect.Effect<
      { readonly labels: ReadonlyArray<VikunjaLabel>; readonly truncated: boolean },
      IssueTrackerError
    >;
    readonly listTasks: (input: {
      readonly projectId: number;
      readonly viewId?: number | undefined;
      readonly page: number;
      readonly perPage: number;
      readonly sortBy: "updated" | "created";
      readonly search?: string | undefined;
      readonly filter?: string | undefined;
    }) => Effect.Effect<
      { readonly tasks: ReadonlyArray<VikunjaTask>; readonly totalPages: number },
      IssueTrackerError
    >;
    readonly getTask: (taskId: number) => Effect.Effect<VikunjaTask | null, IssueTrackerError>;
    readonly createTask: (
      projectId: number,
      input: { readonly title: string; readonly description: string },
    ) => Effect.Effect<VikunjaTask, IssueTrackerError>;
    readonly updateTask: (
      taskId: number,
      task: Record<string, unknown>,
    ) => Effect.Effect<VikunjaTask, IssueTrackerError>;
    readonly listComments: (
      taskId: number,
    ) => Effect.Effect<ReadonlyArray<VikunjaTaskComment>, IssueTrackerError>;
    readonly createComment: (
      taskId: number,
      comment: string,
    ) => Effect.Effect<VikunjaTaskComment, IssueTrackerError>;
    readonly setTaskLabels: (
      taskId: number,
      labelIds: ReadonlyArray<number>,
    ) => Effect.Effect<void, IssueTrackerError>;
    readonly setTaskAssignees: (
      taskId: number,
      userIds: ReadonlyArray<number>,
    ) => Effect.Effect<void, IssueTrackerError>;
    readonly addReaction: (
      kind: "tasks" | "comments",
      id: number,
      value: string,
    ) => Effect.Effect<void, IssueTrackerError>;
    readonly deleteReaction: (
      kind: "tasks" | "comments",
      id: number,
      value: string,
    ) => Effect.Effect<void, IssueTrackerError>;
  }
>()("@t3tools/issue-tracker-vikunja/server/VikunjaApi") {}

const fail = (
  operation: string,
  reason: IssueTrackerError["reason"],
  detail: string,
  extra: { readonly retryAt?: number; readonly cause?: unknown } = {},
) =>
  new IssueTrackerError({
    tracker: KIND,
    operation,
    reason,
    detail,
    ...(extra.retryAt === undefined ? {} : { retryAt: extra.retryAt }),
    ...(extra.cause === undefined ? {} : { cause: extra.cause }),
  });

const decodeErrorMessage = Schema.decodeOption(
  Schema.fromJsonString(
    Schema.Struct({
      message: Schema.optional(Schema.String),
    }),
  ),
);

const decodeUser = Schema.decodeEffect(Schema.fromJsonString(VikunjaUserSchema));
const decodeProjects = Schema.decodeEffect(
  Schema.fromJsonString(Schema.NullOr(Schema.Array(VikunjaProjectSchema))),
);
const decodeProject = Schema.decodeEffect(Schema.fromJsonString(VikunjaProjectSchema));
const decodeProjectViews = Schema.decodeEffect(
  Schema.fromJsonString(Schema.NullOr(Schema.Array(VikunjaProjectViewSchema))),
);
const decodeBuckets = Schema.decodeEffect(
  Schema.fromJsonString(Schema.NullOr(Schema.Array(VikunjaBucketSchema))),
);
const decodeUsers = Schema.decodeEffect(
  Schema.fromJsonString(Schema.NullOr(Schema.Array(VikunjaUserSchema))),
);
const decodeLabels = Schema.decodeEffect(
  Schema.fromJsonString(Schema.NullOr(Schema.Array(VikunjaLabelSchema))),
);
const decodeTasks = Schema.decodeEffect(
  Schema.fromJsonString(Schema.NullOr(Schema.Array(VikunjaTaskSchema))),
);
const decodeTask = Schema.decodeEffect(Schema.fromJsonString(VikunjaTaskSchema));
const decodeComments = Schema.decodeEffect(
  Schema.fromJsonString(Schema.NullOr(Schema.Array(VikunjaTaskCommentSchema))),
);
const decodeComment = Schema.decodeEffect(Schema.fromJsonString(VikunjaTaskCommentSchema));
const decodeUnknownJson = Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown));

function parseTotalPages(headers: Record<string, string | undefined>): number {
  const raw = headers["x-pagination-total-pages"];
  const parsed = raw !== undefined && /^\d+$/u.test(raw.trim()) ? Number(raw.trim()) : 1;
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : 1;
}

function parseRetryAfter(value: string | undefined, now: number): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/u.test(trimmed)) {
    const seconds = Number(trimmed);
    return Number.isSafeInteger(seconds) && seconds > 0 ? now + seconds * 1_000 : undefined;
  }
  const timestamp = Date.parse(trimmed);
  return Number.isFinite(timestamp) && timestamp > now ? timestamp : undefined;
}

export const make = Effect.gen(function* () {
  const config = yield* VikunjaApiConfig.pipe(Effect.orDie);
  const httpClient = yield* HttpClient.HttpClient;
  const host = yield* IssueTrackerHost.IssueTrackerHost;

  const resolveBaseUrl: VikunjaApi["Service"]["resolveBaseUrl"] = () =>
    (host.credentials.getBaseUrl
      ? host.credentials.getBaseUrl(KIND)
      : Effect.succeed(Option.none<string>())
    ).pipe(
      Effect.map((stored) => {
        const raw = Option.isSome(stored) ? stored.value : config.fallbackBaseUrl;
        return normalizeVikunjaBaseUrl(raw);
      }),
    );

  const requireCredentials = Effect.fn("VikunjaApi.requireCredentials")(function* (
    operation: string,
    override?: VikunjaCredentials,
  ): Effect.fn.Return<VikunjaCredentials, IssueTrackerError> {
    if (override !== undefined) {
      const normalized = normalizeVikunjaBaseUrl(override.baseUrl);
      if (normalized === null) {
        return yield* fail(
          operation,
          "failed",
          "Enter a valid Vikunja server URL (for example https://vikunja.example.com).",
        );
      }
      return { token: override.token, baseUrl: normalized };
    }
    const [storedToken, baseUrl] = yield* Effect.all([
      host.credentials.get(KIND),
      resolveBaseUrl(),
    ]);
    if (Option.isNone(storedToken)) {
      return yield* fail(operation, "unauthenticated", "Vikunja is not connected on this server.");
    }
    if (baseUrl === null) {
      return yield* fail(
        operation,
        "unauthenticated",
        "Vikunja has no server URL configured on this server.",
      );
    }
    return { token: storedToken.value, baseUrl };
  });

  const requestJson = Effect.fn("VikunjaApi.requestJson")(function* <A>(input: {
    readonly operation: string;
    readonly method: "GET" | "PUT" | "POST" | "DELETE";
    readonly path: string;
    readonly query?: Record<string, string | number | boolean | undefined> | undefined;
    readonly body?: unknown;
    readonly decode: (jsonText: string) => Effect.Effect<A, Schema.SchemaError>;
    readonly credentials?: VikunjaCredentials | undefined;
  }): Effect.fn.Return<
    {
      readonly data: A;
      readonly headers: Record<string, string | undefined>;
      readonly baseUrl: string;
    },
    IssueTrackerError
  > {
    const creds = yield* requireCredentials(input.operation, input.credentials);
    const url = new URL(`${creds.baseUrl}/api/v1${input.path}`);
    if (input.query !== undefined) {
      for (const [key, value] of Object.entries(input.query)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }
    const baseReq = HttpClientRequest.make(input.method)(url.href).pipe(
      HttpClientRequest.bearerToken(creds.token),
      HttpClientRequest.setHeaders({ accept: "application/json", "user-agent": "t3code" }),
    );
    const req =
      input.body === undefined
        ? baseReq
        : baseReq.pipe(HttpClientRequest.bodyJsonUnsafe(input.body));

    const response = yield* httpClient.execute(req).pipe(
      Effect.mapError((cause) =>
        fail(input.operation, "failed", `Could not reach Vikunja at ${creds.baseUrl}.`, {
          cause,
        }),
      ),
    );

    const headers = response.headers as Record<string, string | undefined>;

    if (response.status === 401 || response.status === 403) {
      return yield* fail(input.operation, "unauthenticated", "Vikunja rejected the API token.");
    }
    if (response.status === 404) {
      return yield* fail(input.operation, "not-found", "Vikunja returned 404 Not Found.");
    }
    if (response.status === 429) {
      const now = yield* Clock.currentTimeMillis;
      const retryAt = parseRetryAfter(headers["retry-after"], now);
      return yield* fail(
        input.operation,
        "rate-limited",
        "Vikunja's rate limit was reached.",
        retryAt === undefined ? {} : { retryAt },
      );
    }

    const rawText = yield* response.text.pipe(
      Effect.mapError((cause) =>
        fail(input.operation, "failed", "Vikunja returned an unreadable response.", { cause }),
      ),
    );

    if (response.status < 200 || response.status >= 300) {
      const parsed = decodeErrorMessage(rawText);
      const detail =
        Option.isSome(parsed) && parsed.value.message?.trim()
          ? parsed.value.message.trim()
          : `Vikunja returned HTTP ${response.status}.`;
      return yield* fail(input.operation, "failed", detail);
    }

    const jsonText = rawText.trim().length === 0 ? "null" : rawText;
    const decoded = yield* input.decode(jsonText).pipe(
      Effect.mapError((cause) =>
        fail(input.operation, "failed", "Vikunja returned an unexpected response shape.", {
          cause,
        }),
      ),
    );

    return { data: decoded, headers, baseUrl: creds.baseUrl };
  });

  const viewer: VikunjaApi["Service"]["viewer"] = (credentials) =>
    requestJson({
      operation: "viewer",
      method: "GET",
      path: "/user",
      decode: decodeUser,
      credentials,
    }).pipe(Effect.map(({ data, baseUrl }) => ({ user: data, baseUrl })));

  const listProjects: VikunjaApi["Service"]["listProjects"] = Effect.fn("VikunjaApi.listProjects")(
    function* (credentials) {
      const projects: VikunjaProject[] = [];
      let page = 1;
      const maxPages = 10;
      while (page <= maxPages) {
        const res = yield* requestJson({
          operation: "listProjects",
          method: "GET",
          path: "/projects",
          query: { page, per_page: 50, is_archived: false },
          decode: decodeProjects,
          credentials,
        });
        const items = res.data ?? [];
        projects.push(...items);
        const totalPages = parseTotalPages(res.headers);
        if (page >= totalPages || items.length === 0) break;
        page += 1;
      }
      return projects;
    },
  );

  const getProject: VikunjaApi["Service"]["getProject"] = (projectId) =>
    requestJson({
      operation: "getProject",
      method: "GET",
      path: `/projects/${projectId}`,
      decode: decodeProject,
    }).pipe(
      Effect.map(({ data }) => data),
      Effect.catchIf(
        (error) => error.reason === "not-found",
        () => Effect.succeed(null),
      ),
    );

  const listProjectViews: VikunjaApi["Service"]["listProjectViews"] = (projectId) =>
    requestJson({
      operation: "listProjectViews",
      method: "GET",
      path: `/projects/${projectId}/views`,
      decode: decodeProjectViews,
    }).pipe(Effect.map(({ data }) => data ?? []));

  const listBuckets: VikunjaApi["Service"]["listBuckets"] = (projectId, viewId) =>
    requestJson({
      operation: "listBuckets",
      method: "GET",
      path: `/projects/${projectId}/views/${viewId}/buckets`,
      decode: decodeBuckets,
    }).pipe(Effect.map(({ data }) => data ?? []));

  const listProjectUsers: VikunjaApi["Service"]["listProjectUsers"] = (projectId) =>
    requestJson({
      operation: "listProjectUsers",
      method: "GET",
      path: `/projects/${projectId}/projectusers`,
      decode: decodeUsers,
    }).pipe(Effect.map(({ data }) => data ?? []));

  const listLabels: VikunjaApi["Service"]["listLabels"] = Effect.fn("VikunjaApi.listLabels")(
    function* () {
      const labels: VikunjaLabel[] = [];
      let page = 1;
      const maxPages = 5;
      let truncated = false;
      while (page <= maxPages) {
        const res = yield* requestJson({
          operation: "listLabels",
          method: "GET",
          path: "/labels",
          query: { page, per_page: 50 },
          decode: decodeLabels,
        });
        const items = res.data ?? [];
        labels.push(...items);
        const totalPages = parseTotalPages(res.headers);
        if (page >= totalPages || items.length === 0) break;
        if (page === maxPages) {
          truncated = true;
          break;
        }
        page += 1;
      }
      return { labels, truncated };
    },
  );

  const listTasks: VikunjaApi["Service"]["listTasks"] = (input) =>
    requestJson({
      operation: "listTasks",
      method: "GET",
      path:
        input.viewId !== undefined
          ? `/projects/${input.projectId}/views/${input.viewId}/tasks`
          : "/tasks",
      query: {
        page: input.page,
        per_page: input.perPage,
        sort_by: input.sortBy,
        order_by: "desc",
        s: input.search,
        filter: input.filter,
        expand: "comment_count",
      },
      decode: decodeTasks,
    }).pipe(
      Effect.map(({ data, headers }) => ({
        tasks: data ?? [],
        totalPages: parseTotalPages(headers),
      })),
    );

  const getTask: VikunjaApi["Service"]["getTask"] = (taskId) =>
    requestJson({
      operation: "getTask",
      method: "GET",
      path: `/tasks/${taskId}`,
      query: { expand: "comment_count" },
      decode: decodeTask,
    }).pipe(
      Effect.map(({ data }) => data),
      Effect.catchIf(
        (error) => error.reason === "not-found",
        () => Effect.succeed(null),
      ),
    );

  const createTask: VikunjaApi["Service"]["createTask"] = (projectId, input) =>
    requestJson({
      operation: "createTask",
      method: "PUT",
      path: `/projects/${projectId}/tasks`,
      body: { title: input.title, description: input.description },
      decode: decodeTask,
    }).pipe(Effect.map(({ data }) => data));

  const updateTask: VikunjaApi["Service"]["updateTask"] = (taskId, task) =>
    requestJson({
      operation: "updateTask",
      method: "POST",
      path: `/tasks/${taskId}`,
      body: task,
      decode: decodeTask,
    }).pipe(Effect.map(({ data }) => data));

  const listComments: VikunjaApi["Service"]["listComments"] = (taskId) =>
    requestJson({
      operation: "listComments",
      method: "GET",
      path: `/tasks/${taskId}/comments`,
      decode: decodeComments,
    }).pipe(Effect.map(({ data }) => data ?? []));

  const createComment: VikunjaApi["Service"]["createComment"] = (taskId, comment) =>
    requestJson({
      operation: "createComment",
      method: "PUT",
      path: `/tasks/${taskId}/comments`,
      body: { comment },
      decode: decodeComment,
    }).pipe(Effect.map(({ data }) => data));

  const setTaskLabels: VikunjaApi["Service"]["setTaskLabels"] = (taskId, labelIds) =>
    requestJson({
      operation: "setTaskLabels",
      method: "POST",
      path: `/tasks/${taskId}/labels/bulk`,
      body: { labels: labelIds.map((id) => ({ id })) },
      decode: decodeUnknownJson,
    }).pipe(Effect.asVoid);

  const setTaskAssignees: VikunjaApi["Service"]["setTaskAssignees"] = (taskId, userIds) =>
    requestJson({
      operation: "setTaskAssignees",
      method: "POST",
      path: `/tasks/${taskId}/assignees/bulk`,
      body: { assignees: userIds.map((id) => ({ id })) },
      decode: decodeUnknownJson,
    }).pipe(Effect.asVoid);

  const addReaction: VikunjaApi["Service"]["addReaction"] = (kind, id, value) =>
    requestJson({
      operation: "addReaction",
      method: "PUT",
      path: `/${kind}/${id}/reactions`,
      body: { value },
      decode: decodeUnknownJson,
    }).pipe(Effect.asVoid);

  const deleteReaction: VikunjaApi["Service"]["deleteReaction"] = (kind, id, value) =>
    requestJson({
      operation: "deleteReaction",
      method: "POST",
      path: `/${kind}/${id}/reactions/delete`,
      body: { value },
      decode: decodeUnknownJson,
    }).pipe(Effect.asVoid);

  return VikunjaApi.of({
    resolveBaseUrl,
    viewer,
    listProjects,
    getProject,
    listProjectViews,
    listBuckets,
    listProjectUsers,
    listLabels,
    listTasks,
    getTask,
    createTask,
    updateTask,
    listComments,
    createComment,
    setTaskLabels,
    setTaskAssignees,
    addReaction,
    deleteReaction,
  });
});

export const layer = Layer.effect(VikunjaApi, make);
