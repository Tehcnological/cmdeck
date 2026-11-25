import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import { classifyPublicAddressAnswer } from "./PublicAddressCheck.ts";

const environmentId = EnvironmentId.make("environment-here");

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
