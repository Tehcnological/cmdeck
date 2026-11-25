import {
  OrchestratorMcpEnvironmentTarget,
  OrchestratorMcpFailure,
  ProviderInstanceId,
  ThreadId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ThreadReview from "../../../review/ThreadReview.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const ThreadReviewTool = Tool.make("t3_thread_review", {
  description:
    "Start a second-model review of a thread's diff in a side chat. Omit `threadId` for this thread. Name the reviewer: `providerInstanceId` and `model` from `orchestrator_capabilities`; none is picked for you. Findings are not returned: they appear in the thread's review banner, and the user decides whether to send them to the agent. To read them, `t3_thread_read` `reviewThreadId` after it ends.",
  parameters: Schema.Struct({
    environmentId: OrchestratorMcpEnvironmentTarget,
    threadId: Schema.optional(ThreadId),
    providerInstanceId: ProviderInstanceId,
    model: TrimmedNonEmptyString,
    instructions: Schema.optional(
      TrimmedNonEmptyString.check(Schema.isMaxLength(4000)).annotate({
        description: "Extra focus for the reviewer.",
      }),
    ),
  }),
  success: Schema.Struct({
    reviewThreadId: ThreadId,
    link: Schema.String,
    status: Schema.Literal("started"),
  }),
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    ThreadReview.ThreadReview,
  ],
})
  .annotate(Tool.Title, "Start a second-model review")
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, true);

export const ReviewToolkit = Toolkit.make(ThreadReviewTool);
