import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Config from "effect/Config";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpClient from "effect/http/HttpClient";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ExternalLauncher from "../process/externalLauncher.ts";
import * as CliTokenManager from "./CliTokenManager.ts";

// T3 Connect is removed: these values used to enable it and must no longer reach Clerk.
const TEST_ENV = {
  T3CODE_CLERK_PUBLISHABLE_KEY: "pk_test_Y2xlcmsuZXhhbXBsZS50ZXN0JA==",
  T3CODE_CLERK_CLI_OAUTH_CLIENT_ID: "oauth_client_test",
  T3CODE_HOSTED_APP_URL: "https://hosted.example.test",
};

const recordingClient = (urls: Array<string>) =>
  HttpClient.make((request) =>
    Effect.suspend(() => {
      urls.push(request.url);
      return Effect.never;
    }),
  );

const expiredStoredToken = new TextEncoder().encode(
  JSON.stringify({ accessToken: "expired", refreshToken: "refresh-token-1", expiresAtEpochMs: 0 }),
);

const provideRefreshManager = (
  httpClient: HttpClient.HttpClient,
  secrets = Layer.mock(ServerSecretStore.ServerSecretStore)({
    get: () => Effect.succeedSome(expiredStoredToken),
  }),
) =>
  Effect.provide(
    CliTokenManager.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(HttpClient.HttpClient, httpClient),
          secrets,
          Layer.mock(ExternalLauncher.ExternalLauncher)({}),
          NodeServices.layer,
          NodeCrypto.layer,
        ),
      ),
      Layer.provideMerge(ConfigProvider.layer(ConfigProvider.fromEnv({ env: TEST_ENV }))),
    ),
  );

it.effect("does not refresh a stored credential without contacting Clerk", () => {
  const urls: Array<string> = [];
  return Effect.gen(function* () {
    const manager = yield* CliTokenManager.CloudCliTokenManager;
    const error = yield* manager.getExisting.pipe(Effect.flip);
    assert.instanceOf(error, CliTokenManager.CloudCliCredentialRefreshError);
    assert.isFalse(error.requiresLogin);
    assert.notInclude(error.message, "t3 connect login");
    assert.deepEqual(urls, []);
    assert.isTrue(yield* manager.hasCredential);
  }).pipe(provideRefreshManager(recordingClient(urls)));
});

it.effect("refuses device sign-in before contacting Clerk", () => {
  const urls: Array<string> = [];
  return CliTokenManager.deviceAuthorizationLogin(() => Effect.void).pipe(
    Effect.flip,
    Effect.map((error) => {
      assert.instanceOf(error, Config.ConfigError);
      assert.deepEqual(urls, []);
    }),
    Effect.provide(Layer.succeed(HttpClient.HttpClient, recordingClient(urls))),
    Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: TEST_ENV }))),
  );
});
