import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as PublicAddressCheck from "./PublicAddressCheck.ts";
import * as ServerEnvironment from "./ServerEnvironment.ts";

const { classifyPublicAddressAnswer } = PublicAddressCheck;
const environmentId = EnvironmentId.make("environment-here");
const DESCRIPTOR =
  '{"environmentId":"environment-here","label":"Here","platform":{"os":"linux","arch":"x64"},' +
  '"serverVersion":"1.2.3","capabilities":{}}';

const checkAnswer = (body: string) =>
  Effect.gen(function* () {
    const service = yield* PublicAddressCheck.PublicAddressCheck;
    return yield* service.check("https://cmdeck.example.com");
  }).pipe(
    Effect.provide(
      PublicAddressCheck.layer.pipe(
        Layer.provide([
          Layer.mock(ServerEnvironment.ServerEnvironment)({
            getEnvironmentId: Effect.succeed(environmentId),
          }),
          Layer.succeed(
            HttpClient.HttpClient,
            HttpClient.make((request) =>
              Effect.succeed(HttpClientResponse.fromWeb(request, new Response(body))),
            ),
          ),
        ]),
      ),
    ),
  );

describe("PublicAddressCheck", () => {
  it.effect("reads at most 64 KiB of the answer", () =>
    Effect.gen(function* () {
      expect(yield* checkAnswer(DESCRIPTOR)).toEqual({ status: "reachable" });
      expect(yield* checkAnswer(`${DESCRIPTOR}${" ".repeat(64 * 1024)}`)).toEqual({
        status: "unreachable",
        httpStatus: 200,
      });
    }),
  );
});

describe("classifyPublicAddressAnswer", () => {
  it("is reachable only when this environment answers", () => {
    expect(
      classifyPublicAddressAnswer({ status: 200, answeredAs: environmentId, environmentId }),
    ).toEqual({ status: "reachable" });
    expect(
      classifyPublicAddressAnswer({
        status: 200,
        answeredAs: EnvironmentId.make("environment-elsewhere"),
        environmentId,
      }),
    ).toEqual({ status: "other-environment" });
  });

  it.each([302, 303, 401, 403])("reads %i as a login gate in front of the server", (status) => {
    expect(classifyPublicAddressAnswer({ status, answeredAs: null, environmentId })).toEqual({
      status: "access-login",
      httpStatus: status,
    });
  });

  it.each([200, 404, 502, 530])("is unreachable on %i without this environment", (status) => {
    expect(classifyPublicAddressAnswer({ status, answeredAs: null, environmentId })).toEqual({
      status: "unreachable",
      httpStatus: status,
    });
  });
});
