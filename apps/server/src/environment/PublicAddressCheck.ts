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
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { FetchHttpClient, HttpClient, type HttpClientResponse } from "effect/http";

import * as ServerEnvironment from "./ServerEnvironment.ts";

const WELL_KNOWN_ENVIRONMENT_PATH = "/.well-known/t3/environment";
const REQUEST_TIMEOUT = Duration.seconds(10);
// A descriptor is a few hundred bytes; an address that streams more is not this server.
const MAX_BODY_BYTES = 64 * 1024;
const decodeDescriptor = Schema.decodeOption(Schema.fromJsonString(ExecutionEnvironmentDescriptor));

/** The body as text, or none once it passes `MAX_BODY_BYTES`; reading stops there. */
function readCappedBody(response: HttpClientResponse.HttpClientResponse) {
  let read = 0;
  return response.stream.pipe(
    Stream.takeWhile((chunk) => {
      read += chunk.length;
      return read <= MAX_BODY_BYTES;
    }),
    Stream.decodeText(),
    Stream.mkString,
    Effect.map((body) => (read > MAX_BODY_BYTES ? Option.none<string>() : Option.some(body))),
    Effect.orElseSucceed(() => Option.none<string>()),
  );
}

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
          ? Option.flatMap(yield* readCappedBody(response), decodeDescriptor)
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
