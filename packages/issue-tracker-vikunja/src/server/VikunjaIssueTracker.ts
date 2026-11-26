/**
 * Vikunja as a standalone self-hosted issue tracker. A scope is a Vikunja project ID (`"12"`), and
 * an issue key is the task's numeric ID (`"42"`). When a project has a Kanban view with buckets,
 * those buckets are offered as workflow states alongside Open/Done.
 */
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import {
  type IssueActor,
  type IssueCapabilities,
  type IssueComment,
  type IssueReaction,
  type IssueReactionContent,
  type IssueState,
  type IssueViewerPermissions,
  type StandaloneIssueTrackerDescriptor,
} from "@t3tools/contracts";
import {
  IssueTrackerError,
  type IssueInvolvementFilter,
  type StandaloneIssueTrackerApi,
  type TrackerIssueSummary,
} from "@t3tools/source-control-core/server/IssueTracker";

import {
  normalizeVikunjaBaseUrl,
  parseVikunjaIssueUrl,
  VIKUNJA_DEFAULT_HOST,
  vikunjaHostFromBaseUrl,
  vikunjaTaskUrl,
} from "../shared/issueUrl.ts";
import * as VikunjaApi from "./VikunjaApi.ts";

const DESCRIPTOR: StandaloneIssueTrackerDescriptor = {
  tracker: VikunjaApi.KIND,
  displayName: "Vikunja",
  host: VIKUNJA_DEFAULT_HOST,
  scopeNoun: "project",
  requiresBaseUrl: true,
  baseUrlPlaceholder: "https://vikunja.example.com",
  credential: {
    label: "API token",
    helpUrl: null,
  },
};

const CAPABILITIES: IssueCapabilities = {
  create: true,
  edit: true,
  comment: true,
  labels: true,
  assignees: true,
  reactions: true,
  templates: false,
  linkedPullRequests: false,
  events: false,
  search: true,
};

const VIEWER_PERMISSIONS: IssueViewerPermissions = {
  setState: true,
  comment: true,
  edit: true,
  labels: true,
  assignees: true,
};

const OPEN_STATE: IssueState = { category: "open", name: "Open" };
const DONE_STATE: IssueState = { category: "closed", name: "Done", closeReason: "completed" };
const EPOCH_FALLBACK = "1970-01-01T00:00:00.000Z";

const EMOJI_BY_CONTENT: Record<IssueReactionContent, string> = {
  "thumbs-up": "👍",
  "thumbs-down": "👎",
  laugh: "😄",
  hooray: "🎉",
  confused: "😕",
  heart: "❤️",
  rocket: "🚀",
  eyes: "👀",
};

const CONTENT_BY_EMOJI = new Map<string, IssueReactionContent>(
  Object.entries(EMOJI_BY_CONTENT).map(([content, emoji]) => [
    emoji,
    content as IssueReactionContent,
  ]),
);

function parsePositiveInt(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^[1-9]\d*$/u.test(trimmed)) return null;
  const num = Number(trimmed);
  return Number.isSafeInteger(num) ? num : null;
}

/** Go's zero `time.Time` serializes as `0001-01-01T00:00:00Z`; treat it as absent. */
function normalizeIsoTimestamp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith("0001-")) return null;
  const parsed = DateTime.make(trimmed);
  return Option.isSome(parsed) ? DateTime.formatIso(parsed.value) : null;
}

function normalizeHexColor(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

function userLogin(user: VikunjaApi.VikunjaUser): string {
  const candidate = user.username?.trim() || user.email?.trim() || user.name?.trim();
  return candidate && candidate.length > 0 ? candidate : String(user.id);
}

function toActor(user: VikunjaApi.VikunjaUser): IssueActor {
  return {
    login: userLogin(user),
    name: user.name?.trim() || null,
    avatarUrl: null,
  };
}

function toReactions(
  reactions: VikunjaApi.VikunjaReactionMap | null | undefined,
  viewerId: number | null,
): IssueReaction[] {
  if (!reactions) return [];
  const result: IssueReaction[] = [];
  for (const [emoji, users] of Object.entries(reactions)) {
    const content = CONTENT_BY_EMOJI.get(emoji);
    if (content === undefined || users.length === 0) continue;
    let viewerHasReacted = false;
    const actors: string[] = [];
    for (const user of users) {
      if (viewerId !== null && user.id === viewerId) {
        viewerHasReacted = true;
      } else {
        actors.push(userLogin(user));
      }
    }
    result.push({ content, count: users.length, actors, viewerHasReacted });
  }
  return result;
}

function toComment(comment: VikunjaApi.VikunjaTaskComment, viewerId: number | null): IssueComment {
  return {
    id: String(comment.id),
    author: comment.author ? toActor(comment.author) : null,
    body: comment.comment,
    createdAt: normalizeIsoTimestamp(comment.created) ?? EPOCH_FALLBACK,
    url: null,
    reactions: toReactions(comment.reactions, viewerId),
  };
}

interface KanbanContext {
  readonly doneBucketId: number | null;
  readonly buckets: ReadonlyArray<VikunjaApi.VikunjaBucket>;
}

function statesForProject(kanban: KanbanContext | null): ReadonlyArray<IssueState> {
  if (kanban === null || kanban.buckets.length === 0) {
    return [OPEN_STATE, DONE_STATE];
  }
  const ordered = kanban.buckets.toSorted((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const states: IssueState[] = ordered.map((bucket) =>
    kanban.doneBucketId !== null && bucket.id === kanban.doneBucketId
      ? { category: "closed", name: bucket.title, closeReason: "completed" }
      : { category: "open", name: bucket.title },
  );
  if (!states.some((state) => state.category === "closed")) {
    states.push(DONE_STATE);
  }
  return states;
}

function stateOfTask(task: VikunjaApi.VikunjaTask, kanban: KanbanContext | null): IssueState {
  if (kanban !== null && task.bucket_id != null && task.bucket_id > 0) {
    const bucket = kanban.buckets.find((entry) => entry.id === task.bucket_id);
    if (bucket !== undefined) {
      if (task.done || (kanban.doneBucketId !== null && bucket.id === kanban.doneBucketId)) {
        return { category: "closed", name: bucket.title, closeReason: "completed" };
      }
      return { category: "open", name: bucket.title };
    }
  }
  return task.done ? DONE_STATE : OPEN_STATE;
}

function toSummary(
  task: VikunjaApi.VikunjaTask,
  baseUrl: string,
  kanban: KanbanContext | null,
  commentCountOverride?: number,
): TrackerIssueSummary {
  const createdAt = normalizeIsoTimestamp(task.created) ?? EPOCH_FALLBACK;
  const updatedAt = normalizeIsoTimestamp(task.updated) ?? createdAt;
  const closedAt = task.done ? (normalizeIsoTimestamp(task.done_at) ?? updatedAt) : null;
  const identifier = task.identifier?.trim();
  return {
    key: String(task.id),
    displayKey: identifier && identifier.length > 0 ? identifier : `#${task.id}`,
    title: task.title.trim() || `Task #${task.id}`,
    url: vikunjaTaskUrl(baseUrl, task.id),
    author: task.created_by ? toActor(task.created_by) : null,
    state: stateOfTask(task, kanban),
    createdAt,
    updatedAt,
    closedAt,
    assignees: (task.assignees ?? []).map(toActor),
    labels: (task.labels ?? []).map((label) => ({
      name: label.title,
      color: normalizeHexColor(label.hex_color),
    })),
    commentCount: Math.max(0, commentCountOverride ?? task.comment_count ?? 0),
  };
}

function matchesInvolvement(task: VikunjaApi.VikunjaTask, filter: IssueInvolvementFilter): boolean {
  if (filter.involvement === "all") return true;
  const viewer = filter.viewer.toLowerCase();
  if (filter.involvement === "assigned") {
    return (task.assignees ?? []).some((user) => userLogin(user).toLowerCase() === viewer);
  }
  if (filter.involvement === "authored") {
    return task.created_by != null && userLogin(task.created_by).toLowerCase() === viewer;
  }
  const text = `${task.title}\n${task.description ?? ""}`.toLowerCase();
  return (
    text.includes(`@${viewer}`) ||
    (task.assignees ?? []).some((user) => userLogin(user).toLowerCase() === viewer)
  );
}

function buildUpdatePayload(
  existing: VikunjaApi.VikunjaTask,
  patch: {
    readonly title?: string | undefined;
    readonly description?: string | undefined;
    readonly done?: boolean | undefined;
    readonly bucket_id?: number | undefined;
  },
): Record<string, unknown> {
  return {
    id: existing.id,
    project_id: existing.project_id,
    title: patch.title ?? existing.title,
    description: patch.description ?? existing.description ?? "",
    done: patch.done ?? existing.done ?? false,
    ...(patch.bucket_id !== undefined
      ? { bucket_id: patch.bucket_id }
      : existing.bucket_id != null
        ? { bucket_id: existing.bucket_id }
        : {}),
    ...(existing.priority != null ? { priority: existing.priority } : {}),
    ...(existing.due_date ? { due_date: existing.due_date } : {}),
    ...(existing.start_date ? { start_date: existing.start_date } : {}),
    ...(existing.end_date ? { end_date: existing.end_date } : {}),
    ...(existing.percent_done != null ? { percent_done: existing.percent_done } : {}),
    ...(existing.hex_color ? { hex_color: existing.hex_color } : {}),
  };
}

const notFound = (operation: string) =>
  new IssueTrackerError({
    tracker: VikunjaApi.KIND,
    operation,
    reason: "not-found",
    detail: "Vikunja has no task with that ID, or this account cannot see it.",
  });

const failed = (operation: string, detail: string) =>
  new IssueTrackerError({ tracker: VikunjaApi.KIND, operation, reason: "failed", detail });

export const make: Effect.Effect<StandaloneIssueTrackerApi, never, VikunjaApi.VikunjaApi> =
  Effect.gen(function* () {
    const vikunja = yield* VikunjaApi.VikunjaApi;

    const requireProjectId = (operation: string, scope: string) => {
      const id = parsePositiveInt(scope);
      return id === null
        ? Effect.fail(failed(operation, `Invalid Vikunja project ID "${scope}".`))
        : Effect.succeed(id);
    };

    const requireTaskId = (operation: string, key: string) => {
      const id = parsePositiveInt(key);
      return id === null ? Effect.fail(notFound(operation)) : Effect.succeed(id);
    };

    const requireBaseUrl = (operation: string) =>
      vikunja.resolveBaseUrl().pipe(
        Effect.filterOrFail(
          (baseUrl): baseUrl is string => baseUrl !== null,
          () =>
            new IssueTrackerError({
              tracker: VikunjaApi.KIND,
              operation,
              reason: "unauthenticated",
              detail: "Vikunja has no server URL configured on this server.",
            }),
        ),
      );

    const loadKanban = (projectId: number): Effect.Effect<KanbanContext | null> =>
      vikunja.listProjectViews(projectId).pipe(
        Effect.flatMap((views) => {
          const kanbanView = views.find((view) => view.view_kind === "kanban");
          if (kanbanView === undefined) return Effect.succeed(null);
          return vikunja.listBuckets(projectId, kanbanView.id).pipe(
            Effect.map((buckets): KanbanContext => ({
              doneBucketId:
                kanbanView.done_bucket_id != null && kanbanView.done_bucket_id > 0
                  ? kanbanView.done_bucket_id
                  : null,
              buckets,
            })),
          );
        }),
        Effect.orElseSucceed(() => null),
      );

    const requireProjectTask = Effect.fn("VikunjaIssueTracker.requireProjectTask")(function* (
      operation: string,
      input: { readonly scope: string; readonly key: string },
    ) {
      const projectId = yield* requireProjectId(operation, input.scope);
      const taskId = yield* requireTaskId(operation, input.key);
      const task = yield* vikunja.getTask(taskId);
      if (task === null) return yield* notFound(operation);
      if (task.project_id !== projectId) {
        return yield* failed(
          operation,
          `Task #${task.id} belongs to Vikunja project ${task.project_id}, not ${projectId}.`,
        );
      }
      return task;
    });

    const resolveLabelIds = (operation: string, names: ReadonlyArray<string>) =>
      names.length === 0
        ? Effect.succeed([] as ReadonlyArray<number>)
        : vikunja.listLabels().pipe(
            Effect.flatMap(({ labels }) =>
              Effect.forEach(names, (name) => {
                const match = labels.find(
                  (label) => label.title.trim().toLowerCase() === name.trim().toLowerCase(),
                );
                return match === undefined
                  ? Effect.fail(failed(operation, `Vikunja has no label named "${name}".`))
                  : Effect.succeed(match.id);
              }),
            ),
          );

    const resolveAssigneeIds = (
      operation: string,
      projectId: number,
      assignees: ReadonlyArray<string>,
    ) =>
      assignees.length === 0
        ? Effect.succeed([] as ReadonlyArray<number>)
        : vikunja.listProjectUsers(projectId).pipe(
            Effect.flatMap((users) =>
              Effect.forEach(assignees, (wanted) => {
                const lower = wanted.trim().toLowerCase();
                const match = users.find(
                  (user) =>
                    String(user.id) === wanted.trim() ||
                    user.username?.toLowerCase() === lower ||
                    user.email?.toLowerCase() === lower ||
                    user.name?.toLowerCase() === lower,
                );
                return match === undefined
                  ? Effect.fail(
                      failed(operation, `"${wanted}" is not a user on this Vikunja project.`),
                    )
                  : Effect.succeed(match.id);
              }),
            ),
          );

    const api: StandaloneIssueTrackerApi = {
      kind: VikunjaApi.KIND,
      capabilities: CAPABILITIES,
      standalone: DESCRIPTOR,
      parseIssueUrl: parseVikunjaIssueUrl,

      resolveBaseUrl: () => vikunja.resolveBaseUrl(),

      resolveHost: () =>
        vikunja
          .resolveBaseUrl()
          .pipe(
            Effect.map((baseUrl) =>
              baseUrl === null ? VIKUNJA_DEFAULT_HOST : vikunjaHostFromBaseUrl(baseUrl),
            ),
          ),

      probeCredential: Effect.fn("VikunjaIssueTracker.probeCredential")(function* (token, baseUrl) {
        const rawBaseUrl = baseUrl ?? (yield* vikunja.resolveBaseUrl()) ?? "";
        const normalized = normalizeVikunjaBaseUrl(rawBaseUrl);
        if (normalized === null) {
          return yield* failed(
            "probeCredential",
            "Enter a valid Vikunja server URL (for example https://vikunja.example.com).",
          );
        }
        const credentials = { token, baseUrl: normalized };
        const [{ user }, projects] = yield* Effect.all([
          vikunja.viewer(credentials),
          vikunja.listProjects(credentials),
        ]);
        return {
          account: userLogin(user),
          host: vikunjaHostFromBaseUrl(normalized),
          baseUrl: normalized,
          workspace: normalized,
          scopes: projects
            .filter((project) => project.id > 0 && !project.is_archived)
            .map((project) => ({
              key: String(project.id),
              name: project.title.trim() || `Project ${project.id}`,
            })),
        };
      }),

      getViewer: () => vikunja.viewer().pipe(Effect.map(({ user }) => userLogin(user))),

      listIssues: Effect.fn("VikunjaIssueTracker.listIssues")(function* (input) {
        const projectId = yield* requireProjectId("listIssues", input.scope);
        const baseUrl = yield* requireBaseUrl("listIssues");
        const page = input.cursor !== undefined ? (parsePositiveInt(input.cursor) ?? 1) : 1;

        const views = yield* vikunja
          .listProjectViews(projectId)
          .pipe(Effect.orElseSucceed(() => [] as ReadonlyArray<VikunjaApi.VikunjaProjectView>));
        const listView =
          views.find((view) => view.view_kind === "list") ??
          views.find((view) => view.view_kind === "table");
        const kanbanView = views.find((view) => view.view_kind === "kanban");
        const kanban: KanbanContext | null =
          kanbanView === undefined
            ? null
            : yield* vikunja.listBuckets(projectId, kanbanView.id).pipe(
                Effect.map((buckets): KanbanContext => ({
                  doneBucketId:
                    kanbanView.done_bucket_id != null && kanbanView.done_bucket_id > 0
                      ? kanbanView.done_bucket_id
                      : null,
                  buckets,
                })),
                Effect.orElseSucceed(() => null),
              );

        const filterClauses: string[] = [];
        if (listView === undefined) {
          filterClauses.push(`project_id = ${projectId}`);
        }
        if (input.state === "open") {
          filterClauses.push("done = false");
        } else if (input.state === "closed") {
          filterClauses.push("done = true");
        }

        const result = yield* vikunja.listTasks({
          projectId,
          viewId: listView?.id,
          page,
          perPage: input.limit,
          sortBy: input.sort === "created" ? "created" : "updated",
          search: input.query,
          filter: filterClauses.length > 0 ? filterClauses.join(" && ") : undefined,
        });

        const requiredLabels = (input.labels ?? []).map((label) => label.trim().toLowerCase());
        const requiredAssignee = input.assignee?.trim().toLowerCase();

        const filtered = result.tasks.filter((task) => {
          if (task.project_id !== projectId) return false;
          if (!matchesInvolvement(task, input)) return false;
          if (requiredLabels.length > 0) {
            const taskLabels = new Set(
              (task.labels ?? []).map((label) => label.title.trim().toLowerCase()),
            );
            if (!requiredLabels.every((wanted) => taskLabels.has(wanted))) return false;
          }
          if (requiredAssignee !== undefined) {
            const hasAssignee = (task.assignees ?? []).some(
              (user) => userLogin(user).toLowerCase() === requiredAssignee,
            );
            if (!hasAssignee) return false;
          }
          return true;
        });

        return {
          items: filtered.map((task) => toSummary(task, baseUrl, kanban)),
          nextCursor: page < result.totalPages ? String(page + 1) : null,
        };
      }),

      getIssue: Effect.fn("VikunjaIssueTracker.getIssue")(function* (input) {
        const taskId = yield* requireTaskId("getIssue", input.key);
        const baseUrl = yield* requireBaseUrl("getIssue");
        const [task, comments, me] = yield* Effect.all([
          vikunja.getTask(taskId),
          vikunja.listComments(taskId).pipe(Effect.orElseSucceed(() => [])),
          vikunja.viewer().pipe(
            Effect.map(({ user }) => user),
            Effect.orElseSucceed(() => null),
          ),
        ]);
        if (task === null) return yield* notFound("getIssue");
        const kanban = yield* loadKanban(task.project_id);
        const viewerId = me?.id ?? null;
        return {
          ...toSummary(task, baseUrl, kanban, comments.length),
          body: task.description ?? "",
          viewer: me === null ? null : userLogin(me),
          viewerPermissions: VIEWER_PERMISSIONS,
          states: statesForProject(kanban),
          reactions: toReactions(task.reactions, viewerId),
          comments: comments.map((comment) => toComment(comment, viewerId)),
          commentsCursor: null,
          events: [],
          linkedPullRequests: [],
        };
      }),

      getComments: () => Effect.succeed({ comments: [], nextCursor: null }),

      create: Effect.fn("VikunjaIssueTracker.create")(function* (input) {
        const projectId = yield* requireProjectId("create", input.scope);
        const baseUrl = yield* requireBaseUrl("create");
        const [labelIds, assigneeIds] = yield* Effect.all([
          resolveLabelIds("create", input.labels),
          resolveAssigneeIds("create", projectId, input.assignees),
        ]);
        const created = yield* vikunja.createTask(projectId, {
          title: input.title,
          description: input.body,
        });
        if (labelIds.length > 0) {
          yield* vikunja.setTaskLabels(created.id, labelIds);
        }
        if (assigneeIds.length > 0) {
          yield* vikunja.setTaskAssignees(created.id, assigneeIds);
        }
        const identifier = created.identifier?.trim();
        return {
          key: String(created.id),
          displayKey: identifier && identifier.length > 0 ? identifier : `#${created.id}`,
          url: vikunjaTaskUrl(baseUrl, created.id),
        };
      }),

      comment: Effect.fn("VikunjaIssueTracker.comment")(function* (input) {
        const task = yield* requireProjectTask("comment", input);
        yield* vikunja.createComment(task.id, input.body);
      }),

      update: Effect.fn("VikunjaIssueTracker.update")(function* (input) {
        const task = yield* requireProjectTask("update", input);
        if (input.title !== undefined || input.body !== undefined) {
          yield* vikunja.updateTask(
            task.id,
            buildUpdatePayload(task, { title: input.title, description: input.body }),
          );
        }
        if (input.labels !== undefined) {
          const labelIds = yield* resolveLabelIds("update", input.labels);
          yield* vikunja.setTaskLabels(task.id, labelIds);
        }
        if (input.assignees !== undefined) {
          const assigneeIds = yield* resolveAssigneeIds("update", task.project_id, input.assignees);
          yield* vikunja.setTaskAssignees(task.id, assigneeIds);
        }
      }),

      setState: Effect.fn("VikunjaIssueTracker.setState")(function* (input) {
        const task = yield* requireProjectTask("setState", input);
        const kanban = yield* loadKanban(task.project_id);
        const wanted = input.state.trim();

        if (kanban !== null && kanban.buckets.length > 0) {
          const bucket = kanban.buckets.find((entry) => entry.title === wanted);
          if (bucket !== undefined) {
            const done = kanban.doneBucketId !== null && bucket.id === kanban.doneBucketId;
            yield* vikunja.updateTask(
              task.id,
              buildUpdatePayload(task, { done, bucket_id: bucket.id }),
            );
            return;
          }
          if (wanted === DONE_STATE.name) {
            yield* vikunja.updateTask(
              task.id,
              buildUpdatePayload(task, {
                done: true,
                ...(kanban.doneBucketId !== null ? { bucket_id: kanban.doneBucketId } : {}),
              }),
            );
            return;
          }
          return yield* failed("setState", `This project has no "${wanted}" state.`);
        }

        if (wanted === OPEN_STATE.name) {
          yield* vikunja.updateTask(task.id, buildUpdatePayload(task, { done: false }));
          return;
        }
        if (wanted === DONE_STATE.name) {
          yield* vikunja.updateTask(task.id, buildUpdatePayload(task, { done: true }));
          return;
        }
        return yield* failed("setState", `Vikunja has no "${wanted}" state for this project.`);
      }),

      setReaction: Effect.fn("VikunjaIssueTracker.setReaction")(function* (input) {
        const task = yield* requireProjectTask("setReaction", input);
        const emoji = EMOJI_BY_CONTENT[input.content];
        if (input.subjectId === undefined) {
          if (input.reacted) yield* vikunja.addReaction("tasks", task.id, emoji);
          else yield* vikunja.deleteReaction("tasks", task.id, emoji);
          return;
        }
        const commentId = parsePositiveInt(input.subjectId);
        if (commentId === null) {
          return yield* failed("setReaction", "Invalid comment ID.");
        }
        const comments = yield* vikunja.listComments(task.id);
        if (!comments.some((comment) => comment.id === commentId)) {
          return yield* failed("setReaction", "The comment does not belong to the selected task.");
        }
        if (input.reacted) yield* vikunja.addReaction("comments", commentId, emoji);
        else yield* vikunja.deleteReaction("comments", commentId, emoji);
      }),

      listCandidates: Effect.fn("VikunjaIssueTracker.listCandidates")(function* (input) {
        const projectId = yield* requireProjectId("listCandidates", input.scope);
        const [labelResult, users] = yield* Effect.all([
          vikunja.listLabels(),
          vikunja.listProjectUsers(projectId),
        ]);
        return {
          labels: labelResult.labels.map((label) => ({
            name: label.title,
            color: normalizeHexColor(label.hex_color),
            description: label.description ?? null,
          })),
          assignees: users.map((user) => ({ ...toActor(user), id: String(user.id) })),
          truncated: labelResult.truncated,
        };
      }),
    };

    return api;
  });
