import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as SqlClient from "effect/sql/SqlClient";
import { IssueTrackerKind, type ProjectId } from "@t3tools/contracts";
import {
  IssueTrackerError,
  type StandaloneIssueTrackerApi,
} from "@t3tools/source-control-core/server/IssueTracker";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as IssueTrackerBindings from "../persistence/IssueTrackerBindings.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as IssueTrackerConnections from "./IssueTrackerConnections.ts";
import * as IssueTrackerRegistry from "./IssueTrackerRegistry.ts";

const LINEAR = IssueTrackerKind.make("linear");

describe("IssueTrackerConnections", () => {
  it.effect("keeps each account's key and bindings apart, and no key past its account", () => {
    const secrets = new Map<string, string>();
    const probing = Deferred.makeUnsafe<void>();
    const released = Deferred.makeUnsafe<void>();
    let random = 0;
    const tracker = {
      kind: LINEAR,
      standalone: { tracker: LINEAR, host: "linear.app" },
      probeCredential: (token: string) =>
        token === "bad"
          ? Effect.fail(
              new IssueTrackerError({
                tracker: LINEAR,
                operation: "viewer",
                reason: "unauthenticated",
                detail: "Linear refused the key.",
              }),
            )
          : Effect.as(
              token === "slow"
                ? Effect.andThen(Deferred.succeed(probing, undefined), Deferred.await(released))
                : Effect.void,
              { account: `user-${token}`, scopes: [] },
            ),
    } as unknown as StandaloneIssueTrackerApi;
    const layer = IssueTrackerConnections.layer.pipe(
      Layer.provideMerge(IssueTrackerBindings.layer),
      Layer.provideMerge(
        Layer.mergeAll(
          SqlitePersistence.layerMemory,
          Layer.succeed(
            IssueTrackerRegistry.IssueTrackerRegistry,
            IssueTrackerRegistry.fromTrackers([tracker]),
          ),
          Layer.mock(ServerSecretStore.ServerSecretStore)({
            get: (name) =>
              Effect.succeed(
                Option.map(Option.fromNullishOr(secrets.get(name)), (value) =>
                  new TextEncoder().encode(value),
                ),
              ),
            set: (name, value) =>
              Effect.sync(() => void secrets.set(name, new TextDecoder().decode(value))),
            remove: (name) => Effect.sync(() => void secrets.delete(name)),
          }),
          Layer.succeed(
            SecureRandom.SecureRandom,
            SecureRandom.make((size) => new Uint8Array(size).fill(++random)),
          ),
        ),
      ),
    );
    return Effect.gen(function* () {
      const connections = yield* IssueTrackerConnections.IssueTrackerConnections;
      yield* connections.connect({ tracker: LINEAR, token: "work" });
      const { accountId } = yield* connections.connect({
        tracker: LINEAR,
        token: "home",
        addAccount: true,
      });

      // The first account keeps the name it was saved under before accounts existed.
      expect(Object.fromEntries(secrets)).toEqual({
        "issue-tracker-bGluZWFy-token": "work",
        [`issue-tracker-bGluZWFy-account-${accountId}-token`]: "home",
      });
      yield* connections.bindProject({
        projectId: "work" as ProjectId,
        binding: { tracker: LINEAR, scope: "ENG" },
      });
      yield* connections.bindProject({
        projectId: "home" as ProjectId,
        binding: { tracker: LINEAR, accountId, scope: "ENG" },
      });
      // Older clients read `bindings` as the first account's, so the second one's are apart.
      expect(yield* connections.list).toMatchObject({
        accounts: [{ accountId, account: "user-home" }],
        bindings: { work: { tracker: LINEAR, scope: "ENG" } },
        accountBindings: { home: { tracker: LINEAR, accountId, scope: "ENG" } },
      });
      // An older client offers the added account's project as unbound; its unbind leaves it.
      yield* connections.bindProject({ projectId: "home" as ProjectId, binding: null });
      expect((yield* connections.list).accountBindings).toHaveProperty("home");
      yield* Effect.flip(connections.connect({ tracker: LINEAR, token: "bad", addAccount: true }));
      expect(
        yield* Effect.flip(
          connections.connect({ tracker: LINEAR, token: "home", addAccount: true }),
        ),
      ).toMatchObject({ detail: "This credential is already connected as another account." });
      expect(secrets.size).toBe(2);

      // A removal does not wait on a replacement key's probe, and the replacement then finds its
      // account gone instead of storing a key for it.
      const replacing = yield* connections
        .connect({ tracker: LINEAR, accountId, token: "slow" })
        .pipe(Effect.forkChild({ startImmediately: true }));
      yield* Deferred.await(probing);
      yield* connections.connect({ tracker: LINEAR, accountId, token: null });
      yield* Deferred.succeed(released, undefined);
      expect(yield* Effect.flip(Fiber.join(replacing))).toMatchObject({
        detail: "This account is not saved on the server.",
      });
      expect([...secrets.keys()]).toEqual(["issue-tracker-bGluZWFy-token"]);
      const after = yield* connections.list;
      expect([after.accounts, after.accountBindings]).toEqual([[], {}]);
      expect(
        yield* Effect.flip(
          connections.bindProject({
            projectId: "home" as ProjectId,
            binding: { tracker: LINEAR, accountId, scope: "ENG" },
          }),
        ),
      ).toMatchObject({ detail: "This account is not saved on the server." });

      // An account that cannot be saved takes its new key with it.
      yield* (yield* SqlClient.SqlClient)`DROP TABLE issue_tracker_accounts`;
      yield* Effect.flip(connections.connect({ tracker: LINEAR, token: "home", addAccount: true }));
      expect(secrets.size).toBe(1);
    }).pipe(Effect.provide(layer));
  });

  it.effect("stores and removes self-hosted base URLs per account", () => {
    const VIKUNJA = IssueTrackerKind.make("vikunja");
    const secrets = new Map<string, string>();
    let random = 0;
    const tracker = {
      kind: VIKUNJA,
      standalone: {
        tracker: VIKUNJA,
        displayName: "Vikunja",
        host: "vikunja.io",
        scopeNoun: "project",
        requiresBaseUrl: true,
        baseUrlPlaceholder: "https://vikunja.example.com",
        credential: { label: "API token", helpUrl: null },
      },
      probeCredential: (token: string, baseUrl?: string) => {
        if (!baseUrl) {
          return Effect.fail(
            new IssueTrackerError({
              tracker: VIKUNJA,
              operation: "probeCredential",
              reason: "failed",
              detail: "Enter a valid Vikunja server URL.",
            }),
          );
        }
        const normalized = baseUrl.replace(/\/+$/u, "");
        return Effect.succeed({
          account: `user-${token}`,
          host: new URL(normalized).host.toLowerCase(),
          baseUrl: normalized,
          workspace: normalized,
          scopes: [{ key: "7", name: "Core" }],
        });
      },
    } as unknown as StandaloneIssueTrackerApi;
    const layer = IssueTrackerConnections.layer.pipe(
      Layer.provideMerge(IssueTrackerBindings.layer),
      Layer.provideMerge(
        Layer.mergeAll(
          SqlitePersistence.layerMemory,
          Layer.succeed(
            IssueTrackerRegistry.IssueTrackerRegistry,
            IssueTrackerRegistry.fromTrackers([tracker]),
          ),
          Layer.mock(ServerSecretStore.ServerSecretStore)({
            get: (name) =>
              Effect.succeed(
                Option.map(Option.fromNullishOr(secrets.get(name)), (value) =>
                  new TextEncoder().encode(value),
                ),
              ),
            set: (name, value) =>
              Effect.sync(() => void secrets.set(name, new TextDecoder().decode(value))),
            remove: (name) => Effect.sync(() => void secrets.delete(name)),
          }),
          Layer.succeed(
            SecureRandom.SecureRandom,
            SecureRandom.make((size) => new Uint8Array(size).fill(++random)),
          ),
        ),
      ),
    );
    return Effect.gen(function* () {
      const connections = yield* IssueTrackerConnections.IssueTrackerConnections;
      const first = yield* connections.connect({
        tracker: VIKUNJA,
        token: "tok-1",
        baseUrl: "https://work.vikunja.example/",
      });
      expect(first).toMatchObject({
        host: "work.vikunja.example",
        baseUrl: "https://work.vikunja.example",
        workspace: "https://work.vikunja.example",
      });

      // Adding a second account with a different instance URL stores its own baseUrl secret,
      // even if the token string happens to match.
      const second = yield* connections.connect({
        tracker: VIKUNJA,
        token: "tok-1",
        baseUrl: "https://home.vikunja.example:8443/",
        addAccount: true,
      });
      expect(second).toMatchObject({
        host: "home.vikunja.example:8443",
        baseUrl: "https://home.vikunja.example:8443",
        workspace: "https://home.vikunja.example:8443",
      });
      expect(Object.fromEntries(secrets)).toEqual({
        "issue-tracker-dmlrdW5qYQ-token": "tok-1",
        "issue-tracker-dmlrdW5qYQ-base-url": "https://work.vikunja.example",
        [`issue-tracker-dmlrdW5qYQ-account-${second.accountId}-token`]: "tok-1",
        [`issue-tracker-dmlrdW5qYQ-account-${second.accountId}-base-url`]:
          "https://home.vikunja.example:8443",
      });

      // Duplicate token on the same baseUrl is still rejected.
      expect(
        yield* Effect.flip(
          connections.connect({
            tracker: VIKUNJA,
            token: "tok-1",
            baseUrl: "https://home.vikunja.example:8443",
            addAccount: true,
          }),
        ),
      ).toMatchObject({ detail: "This credential is already connected as another account." });

      // Replacing the second account's token without re-sending baseUrl preserves its stored URL.
      const replaced = yield* connections.connect({
        tracker: VIKUNJA,
        accountId: second.accountId,
        token: "tok-2",
      });
      expect(replaced).toMatchObject({
        accountId: second.accountId,
        account: "user-tok-2",
        baseUrl: "https://home.vikunja.example:8443",
      });

      // Listing returns each account with its own host and baseUrl.
      const listed = yield* connections.list;
      expect(listed.trackers[0]).toMatchObject({
        host: "work.vikunja.example",
        baseUrl: "https://work.vikunja.example",
      });
      expect(listed.accounts?.[0]).toMatchObject({
        accountId: second.accountId,
        host: "home.vikunja.example:8443",
        baseUrl: "https://home.vikunja.example:8443",
      });

      // Disconnecting the second account removes only its token and baseUrl secrets.
      yield* connections.connect({
        tracker: VIKUNJA,
        accountId: second.accountId,
        token: null,
      });
      expect(Object.fromEntries(secrets)).toEqual({
        "issue-tracker-dmlrdW5qYQ-token": "tok-1",
        "issue-tracker-dmlrdW5qYQ-base-url": "https://work.vikunja.example",
      });
    }).pipe(Effect.provide(layer));
  });
});
