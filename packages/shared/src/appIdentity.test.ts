// @effect-diagnostics nodeBuiltinImport:off - resolves paths the way the entrypoints do.
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import { applyAppHomeEnv } from "./appIdentity.ts";

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
