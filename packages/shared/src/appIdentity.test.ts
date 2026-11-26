// @effect-diagnostics nodeBuiltinImport:off - resolves paths the way the entrypoints do.
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import { appReleaseTag, applyAppHomeEnv, formatAppVersion } from "./appIdentity.ts";

const linux = {
  homeDir: "/home/me",
  platform: "linux",
  resolve: (path: string) => NodePath.posix.resolve("/home/me/work", path),
};

describe("applyAppHomeEnv", () => {
  it("lets CMDECK_HOME win, even over the official home", () => {
    const env: Record<string, string | undefined> = {
      CMDECK_HOME: "/data/cmdeck",
      T3CODE_HOME: "/home/me/.t3",
    };
    expect(applyAppHomeEnv(env, linux)).toBeUndefined();
    expect(env["T3CODE_HOME"]).toBe("/data/cmdeck");
  });

  it.each(["~/.t3", "/home/me/.t3/", "../.t3", " /home/me/.t3 "])(
    "drops T3CODE_HOME=%j, the official T3 Code home",
    (value) => {
      const env: Record<string, string | undefined> = { T3CODE_HOME: value };
      expect(applyAppHomeEnv(env, linux)).toBe(value.trim());
      expect("T3CODE_HOME" in env).toBe(false);
    },
  );

  it("keeps any other T3CODE_HOME, such as a test's temporary folder", () => {
    for (const value of ["/tmp/t3-test-home", "~/.t3-dev", "/home/me/.T3"]) {
      const env: Record<string, string | undefined> = { T3CODE_HOME: value };
      expect(applyAppHomeEnv(env, linux)).toBeUndefined();
      expect(env["T3CODE_HOME"]).toBe(value);
    }
  });

  it("ignores case where the file system does", () => {
    const env: Record<string, string | undefined> = { T3CODE_HOME: "C:\\Users\\Me\\.T3" };
    const windows = {
      homeDir: "C:\\Users\\me",
      platform: "win32",
      resolve: (path: string) => NodePath.win32.resolve("C:\\work", path),
    };
    expect(applyAppHomeEnv(env, windows)).toBe("C:\\Users\\Me\\.T3");
  });
});

describe("formatAppVersion", () => {
  it("shows release N.0.0 as vN and leaves other versions alone", () => {
    expect(formatAppVersion("2.0.0")).toBe("v2");
    expect(formatAppVersion("13.0.0")).toBe("v13");
    expect(formatAppVersion("2.0.1")).toBe("2.0.1");
    expect(formatAppVersion("2.1.0")).toBe("2.1.0");
    expect(formatAppVersion("3.0.0-nightly.20261125.1")).toBe("3.0.0-nightly.20261125.1");
    expect(formatAppVersion("0.0.0")).toBe("0.0.0");
  });

  it("shows beta N.0.0-beta.M as its tag vN-beta.M", () => {
    expect(formatAppVersion("3.0.0-beta.1")).toBe("v3-beta.1");
    expect(formatAppVersion("12.0.0-beta.10")).toBe("v12-beta.10");
    expect(formatAppVersion("3.0.0-beta.0")).toBe("3.0.0-beta.0");
    expect(formatAppVersion("3.1.0-beta.1")).toBe("3.1.0-beta.1");
    expect(appReleaseTag("3.0.0-beta.2")).toBe("v3-beta.2");
  });

  it("names the release tag", () => {
    expect(appReleaseTag("2.0.0")).toBe("v2");
    expect(appReleaseTag("0.1.12")).toBe("v0.1.12");
  });
});
