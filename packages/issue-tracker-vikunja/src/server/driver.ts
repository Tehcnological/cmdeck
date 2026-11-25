import * as Effect from "effect/Effect";

import * as VikunjaApi from "./VikunjaApi.ts";
import * as VikunjaIssueTracker from "./VikunjaIssueTracker.ts";

/**
 * The Vikunja tracker over its REST API v1 client. Needs the platform HttpClient, and the server's
 * `IssueTrackerHost` for the server URL and API token saved in Settings.
 */
export const make = VikunjaIssueTracker.make.pipe(
  Effect.provideServiceEffect(VikunjaApi.VikunjaApi, VikunjaApi.make),
);
