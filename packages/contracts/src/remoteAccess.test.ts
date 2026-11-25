import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { AuthAccessWriteScope } from "./auth.ts";
import {
  requiredScopesForServerSettingsPatch,
  ServerSettings,
  ServerSettingsPatch,
} from "./settings.ts";
import { PublicBaseUrl, publicBaseOrigin } from "./remoteAccess.ts";

const isPublicBaseUrl = Schema.is(PublicBaseUrl);

describe("PublicBaseUrl", () => {
  const accepted = [
    "",
    "https://cmdeck.example.com",
    "https://cmdeck.example.com/",
    "https://box:8443",
  ];
  it.each(accepted)("accepts %j", (value) => {
    expect(isPublicBaseUrl(value)).toBe(true);
  });

  it.each([
    "http://cmdeck.example.com",
    "cmdeck.example.com",
    "https://user:secret@cmdeck.example.com",
    "https://cmdeck.example.com/app",
    "https://cmdeck.example.com/?token=1",
    "https://cmdeck.example.com/#pair",
    "https://cmdeck.example.com?",
    " https://cmdeck.example.com",
    "javascript:alert(1)",
  ])("rejects %j", (value) => {
    expect(isPublicBaseUrl(value)).toBe(false);
  });

  it("is an origin that paths append to", () => {
    expect(publicBaseOrigin("https://cmdeck.example.com/")).toBe("https://cmdeck.example.com");
    expect(publicBaseOrigin("")).toBeNull();
  });

  it("defaults to unset and needs access management to change", () => {
    const settings = Schema.decodeSync(ServerSettings)({});
    expect(settings.publicBaseUrl).toBe("");
    expect(settings.remoteMcpEnabled).toBe(false);
    expect(() =>
      Schema.decodeSync(ServerSettingsPatch)({ publicBaseUrl: "http://plain.example" }),
    ).toThrow();
    for (const patch of [
      { publicBaseUrl: "https://cmdeck.example.com" },
      { remoteMcpEnabled: true },
    ]) {
      expect(requiredScopesForServerSettingsPatch(patch)).toEqual([AuthAccessWriteScope]);
    }
  });
});
