// @effect-diagnostics nodeBuiltinImport:off -- Runs the real install script against a temp folder.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Option from "effect/Option";
import { describe, expect, it } from "vite-plus/test";

import {
  decodeMacUpdateInfo,
  isTranslocatedAppPath,
  macInstallScriptArgs,
  resolveMacAppBundlePath,
  resolveMacUpdateFileUrl,
  selectMacUpdateZip,
  sha512Matches,
} from "./macBundleUpdate.ts";

const file = (url: string) => ({ url, sha512: "x", size: 1 });

describe("decodeMacUpdateInfo", () => {
  it("reads what electron-updater reports for latest-mac.yml", () => {
    const info = decodeMacUpdateInfo({
      version: "2.0.0",
      tag: "v2",
      files: [{ url: "CMDeck-2.0.0-arm64.zip", sha512: "abc", size: 10, blockMapSize: 3 }],
      path: "CMDeck-2.0.0-arm64.zip",
      releaseDate: "2026-11-25T00:00:00.000Z",
    });
    expect(Option.getOrThrow(info).files[0]?.url).toBe("CMDeck-2.0.0-arm64.zip");
    expect(Option.isNone(decodeMacUpdateInfo({ version: "2.0.0" }))).toBe(true);
  });
});

describe("selectMacUpdateZip", () => {
  const files = [
    file("CMDeck-2.0.0-arm64.dmg"),
    file("CMDeck-2.0.0-x64.zip"),
    file("CMDeck-2.0.0-arm64.zip"),
  ];

  it("prefers the arm64 zip on Apple silicon and never offers a dmg", () => {
    expect(Option.getOrThrow(selectMacUpdateZip(files, true)).url).toBe("CMDeck-2.0.0-arm64.zip");
    expect(Option.getOrThrow(selectMacUpdateZip(files, false)).url).toBe("CMDeck-2.0.0-x64.zip");
  });

  it("finds nothing for an Intel Mac when only arm64 is published", () => {
    expect(Option.isNone(selectMacUpdateZip([file("CMDeck-2.0.0-arm64.zip")], false))).toBe(true);
  });
});

describe("resolveMacUpdateFileUrl", () => {
  const info = { version: "2.0.0", files: [] };

  it("downloads from the CMDeck release the feed named", () => {
    expect(resolveMacUpdateFileUrl(info, file("CMDeck-2.0.0-arm64.zip"), undefined)).toBe(
      "https://github.com/Tehcnological/cmdeck/releases/download/v2/CMDeck-2.0.0-arm64.zip",
    );
    expect(
      resolveMacUpdateFileUrl({ ...info, tag: "v3" }, file("CMDeck-3.0.0-arm64.zip"), undefined),
    ).toBe("https://github.com/Tehcnological/cmdeck/releases/download/v3/CMDeck-3.0.0-arm64.zip");
  });

  it("downloads a beta from its vN-beta.M release", () => {
    const beta = { version: "3.0.0-beta.2", files: [] };
    const url =
      "https://github.com/Tehcnological/cmdeck/releases/download/v3-beta.2/CMDeck-3.0.0-beta.2-arm64.zip";
    expect(resolveMacUpdateFileUrl(beta, file("CMDeck-3.0.0-beta.2-arm64.zip"), undefined)).toBe(
      url,
    );
    expect(
      resolveMacUpdateFileUrl(
        { ...beta, tag: "v3-beta.2" },
        file("CMDeck-3.0.0-beta.2-arm64.zip"),
        undefined,
      ),
    ).toBe(url);
  });

  it("downloads from a generic feed beside its latest-mac.yml", () => {
    expect(resolveMacUpdateFileUrl(info, file("a.zip"), "http://localhost:3000")).toBe(
      "http://localhost:3000/a.zip",
    );
    expect(resolveMacUpdateFileUrl(info, file("a.zip"), "https://mirror.test/cmdeck/")).toBe(
      "https://mirror.test/cmdeck/a.zip",
    );
  });
});

describe("sha512Matches", () => {
  const digest = NodeCrypto.createHash("sha512").update("CMDeck").digest();

  it("accepts the base64 latest-mac.yml stores and the hex form", () => {
    expect(sha512Matches(digest, digest.toString("base64"))).toBe(true);
    expect(sha512Matches(digest, digest.toString("hex").toUpperCase())).toBe(true);
  });

  it("rejects any other digest", () => {
    const other = NodeCrypto.createHash("sha512").update("T3 Code").digest();
    expect(sha512Matches(digest, other.toString("base64"))).toBe(false);
    expect(sha512Matches(digest, "")).toBe(false);
  });
});

describe("resolveMacAppBundlePath", () => {
  it("finds the bundle that holds the running executable", () => {
    expect(resolveMacAppBundlePath("/Applications/CMDeck.app/Contents/MacOS/CMDeck")).toEqual(
      Option.some("/Applications/CMDeck.app"),
    );
    expect(resolveMacAppBundlePath("/Users/me/Apps/CMDeck 2.app/Contents/MacOS/CMDeck")).toEqual(
      Option.some("/Users/me/Apps/CMDeck 2.app"),
    );
  });

  it("refuses anything that is not a bundle executable", () => {
    expect(Option.isNone(resolveMacAppBundlePath("/usr/local/bin/electron"))).toBe(true);
    expect(
      Option.isNone(
        resolveMacAppBundlePath(
          "/Applications/CMDeck.app/Contents/Frameworks/Helper.app/Contents/Resources/x",
        ),
      ),
    ).toBe(true);
  });

  it("recognizes a translocated launch", () => {
    expect(isTranslocatedAppPath("/private/var/folders/x/AppTranslocation/ABC/d/CMDeck.app")).toBe(
      true,
    );
    expect(isTranslocatedAppPath("/Applications/CMDeck.app")).toBe(false);
  });
});

describe.skipIf(HostProcess.Platform.defaultValue() === "win32")("mac install script", () => {
  const exitedPid = () => {
    const child = NodeChildProcess.spawnSync("/bin/sh", ["-c", "echo $$"], { encoding: "utf8" });
    return Number(child.stdout.trim());
  };

  const runScript = (stagedAppPath: string, appPath: string) =>
    NodeChildProcess.spawnSync(
      "/bin/sh",
      macInstallScriptArgs({ pid: exitedPid(), appPath, stagedAppPath, relaunch: "true" }),
      { encoding: "utf8" },
    );

  const makeApp = (path: string, marker: string) => {
    NodeFS.mkdirSync(NodePath.join(path, "Contents"), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(path, "Contents", "marker"), marker);
  };

  it("swaps in the staged bundle and leaves nothing beside it", () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "cmdeck-mac-install-"));
    try {
      const appPath = NodePath.join(root, "Apps", "CMDeck.app");
      const stagedAppPath = NodePath.join(root, "staging", "CMDeck.app");
      makeApp(appPath, "old");
      makeApp(stagedAppPath, "new");

      expect(runScript(stagedAppPath, appPath).status).toBe(0);

      expect(NodeFS.readFileSync(NodePath.join(appPath, "Contents", "marker"), "utf8")).toBe("new");
      expect(NodeFS.readdirSync(NodePath.dirname(appPath))).toEqual(["CMDeck.app"]);
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps the installed bundle when the staged one is missing", () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "cmdeck-mac-install-"));
    try {
      const appPath = NodePath.join(root, "Apps", "CMDeck.app");
      makeApp(appPath, "old");

      runScript(NodePath.join(root, "missing", "CMDeck.app"), appPath);

      expect(NodeFS.readFileSync(NodePath.join(appPath, "Contents", "marker"), "utf8")).toBe("old");
      expect(NodeFS.readdirSync(NodePath.dirname(appPath))).toEqual(["CMDeck.app"]);
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });
});
