import {
  ExecutionEnvironmentDescriptor,
  type EnvironmentId,
  type PublicAddressCheckResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http";

import * as ServerEnvironment from "./ServerEnvironment.ts";

const WELL_KNOWN_ENVIRONMENT_PATH = "/.well-known/t3/environment";
const REQUEST_TIMEOUT = Duration.seconds(10);

/**
 * `/.well-known/t3/environment` needs no sign-in, so a redirect or a 401/403 there comes from a
 * gate in front of this server, such as Cloudflare Access.
 */
export function classifyPublicAddressAnswer(input: {
  readonly status: number;
  readonly answeredAs: EnvironmentId | null;
  readonly environmentId: EnvironmentId;
}): PublicAddressCheckResult {
  const { status, answeredAs, environmentId } = input;
  if (status === 200 && answeredAs !== null) {
    return { status: answeredAs === environmentId ? "reachable" : "other-environment" };
  }
  if (status === 401 || status === 403 || (status >= 300 && status < 400)) {
    return { status: "access-login", httpStatus: status };
  }
  return { status: "unreachable", httpStatus: status };
}

export class PublicAddressCheck extends Context.Service<
  PublicAddressCheck,
  {
    /** Asks `<url>/.well-known/t3/environment`, from this server, which environment answers. */
    readonly check: (url: string) => Effect.Effect<PublicAddressCheckResult>;
  }
>()("t3/environment/PublicAddressCheck") {}

const make = Effect.gen(function* () {
  const environment = yield* ServerEnvironment.ServerEnvironment;
  // A redirect is reported, not followed: it is how a login gate answers.
  const client = (yield* HttpClient.HttpClient).pipe(
    HttpClient.transformResponse(
      Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }),
    ),
  );

  const probe = Effect.fn("PublicAddressCheck.probe")(
    function* (url: string) {
      const response = yield* client.get(new URL(WELL_KNOWN_ENVIRONMENT_PATH, url).href, {
        acceptJson: true,
      });
      const descriptor =
        response.status === 200
          ? yield* HttpClientResponse.schemaBodyJson(ExecutionEnvironmentDescriptor)(response).pipe(
              Effect.option,
            )
          : Option.none();
      return {
        status: response.status,
        answeredAs: Option.isSome(descriptor) ? descriptor.value.environmentId : null,
      };
    },
    Effect.scoped,
    Effect.timeoutOption(REQUEST_TIMEOUT),
    Effect.orElseSucceed(() => Option.none()),
  );

  const check = Effect.fn("PublicAddressCheck.check")(function* (url: string) {
    const answer = yield* probe(url);
    if (Option.isNone(answer)) return { status: "unreachable" } satisfies PublicAddressCheckResult;
    return classifyPublicAddressAnswer({
      ...answer.value,
      environmentId: yield* environment.getEnvironmentId,
    });
  });

  return PublicAddressCheck.of({ check });
});

export const layer = Layer.effect(PublicAddressCheck, make);
