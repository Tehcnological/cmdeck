/**
 * The server's `IssueTrackerHost`: standalone tracker credentials out of the secret store, one
 * per tracker account. The first account's name is stable across releases so a saved key
 * survives upgrades.
 *
 * @module issue/IssueTrackerHostLive
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type { IssueTrackerAccountId, IssueTrackerKind } from "@t3tools/contracts";
import { IssueTrackerError } from "@t3tools/source-control-core/server/IssueTracker";
import * as IssueTrackerHost from "@t3tools/source-control-core/server/IssueTrackerHost";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";

export function issueTrackerSecretName(
  tracker: IssueTrackerKind,
  accountId: IssueTrackerAccountId | null = null,
): string {
  const kind = Buffer.from(tracker, "utf8").toString("base64url");
  return accountId === null
    ? `issue-tracker-${kind}-token`
    : `issue-tracker-${kind}-account-${accountId}-token`;
}

export function issueTrackerBaseUrlSecretName(
  tracker: IssueTrackerKind,
  accountId: IssueTrackerAccountId | null = null,
): string {
  const kind = Buffer.from(tracker, "utf8").toString("base64url");
  return accountId === null
    ? `issue-tracker-${kind}-base-url`
    : `issue-tracker-${kind}-account-${accountId}-base-url`;
}

const decoder = new TextDecoder();

const make = Effect.gen(function* () {
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const readSecret = (
    tracker: IssueTrackerKind,
    nameFor: (accountId: IssueTrackerAccountId | null) => string,
    operation: string,
  ) =>
    Effect.flatMap(IssueTrackerHost.IssueTrackerAccount, (accountId) =>
      secrets.get(nameFor(accountId)),
    ).pipe(
      Effect.map(Option.map((bytes) => decoder.decode(bytes))),
      Effect.mapError(
        (cause) =>
          new IssueTrackerError({
            tracker,
            operation,
            reason: "failed",
            detail: "The stored credential could not be read.",
            cause,
          }),
      ),
    );
  return IssueTrackerHost.IssueTrackerHost.of({
    credentials: {
      get: (tracker) =>
        readSecret(
          tracker,
          (accountId) => issueTrackerSecretName(tracker, accountId),
          "readCredential",
        ),
      getBaseUrl: (tracker) =>
        readSecret(
          tracker,
          (accountId) => issueTrackerBaseUrlSecretName(tracker, accountId),
          "readBaseUrl",
        ),
    },
  });
});

export const layer = Layer.effect(IssueTrackerHost.IssueTrackerHost, make);
