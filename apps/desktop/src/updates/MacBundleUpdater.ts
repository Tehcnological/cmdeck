// @effect-diagnostics nodeBuiltinImport:off -- Hashes the download as it streams, runs ditto and plutil, and spawns the detached install helper that outlives the app.
/**
 * MacBundleUpdater - the macOS ElectronUpdater. electron-updater still checks the feed, but the
 * download and install are CMDeck's own (see macBundleUpdate.ts), reported through the same
 * updater events so DesktopUpdates drives macOS like every other platform.
 *
 * @module MacBundleUpdater
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeEvents from "node:events";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeStream from "node:stream";
import * as NodeStreamPromises from "node:stream/promises";
import type * as NodeStreamWeb from "node:stream/web";

import { DESKTOP_APP_ID } from "@t3tools/shared/appIdentity";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Electron from "electron";
import { autoUpdater } from "electron-updater";

import * as ElectronUpdater from "../electron/ElectronUpdater.ts";
import {
  MAC_UPDATE_RELEASES_URL,
  MacBundleUpdateError,
  type MacUpdateFile,
  type MacUpdateInfo,
  decodeMacUpdateInfo,
  isTranslocatedAppPath,
  macInstallScriptArgs,
  macUpdateLocationMessage,
  resolveMacAppBundlePath,
  resolveMacUpdateFileUrl,
  selectMacUpdateZip,
  sha512Matches,
} from "./macBundleUpdate.ts";

interface StagedUpdate {
  readonly dir: string;
  readonly appPath: string;
  readonly stagedAppPath: string;
}

const fail = (reason: string, cause?: unknown) => new MacBundleUpdateError({ reason, cause });

const execFile = (file: string, args: ReadonlyArray<string>) =>
  new Promise<string>((resolve, reject) => {
    NodeChildProcess.execFile(file, args, (error, stdout) =>
      error ? reject(error) : resolve(stdout),
    );
  });

const readPlistString = (plistPath: string, key: string) =>
  execFile("/usr/bin/plutil", ["-extract", key, "raw", "-o", "-", plistPath]).then((value) =>
    value.trim(),
  );

const runningAppPath = (): string =>
  Option.getOrThrowWith(resolveMacAppBundlePath(process.execPath), () =>
    fail(`CMDeck is not running from an app bundle (${process.execPath}).`),
  );

function assertReplaceable(appPath: string): void {
  if (isTranslocatedAppPath(appPath)) throw fail(macUpdateLocationMessage(appPath));
  try {
    NodeFS.accessSync(NodePath.dirname(appPath), NodeFS.constants.W_OK);
    NodeFS.accessSync(appPath, NodeFS.constants.W_OK);
  } catch (cause) {
    throw fail(macUpdateLocationMessage(appPath), cause);
  }
}

async function downloadVerified(
  url: string,
  file: MacUpdateFile,
  destination: string,
  onPercent: (percent: number) => void,
): Promise<void> {
  const response = await Electron.net.fetch(url);
  if (!response.ok || response.body === null) {
    throw fail(`Downloading the macOS update failed (HTTP ${response.status}).`);
  }
  const total = Number(response.headers.get("content-length")) || file.size || 0;
  const hash = NodeCrypto.createHash("sha512");
  let received = 0;
  let reported = -1;
  await NodeStreamPromises.pipeline(
    NodeStream.Readable.fromWeb(response.body as NodeStreamWeb.ReadableStream<Uint8Array>),
    new NodeStream.Transform({
      transform(chunk: Buffer, _encoding, next) {
        hash.update(chunk);
        received += chunk.length;
        const percent = total > 0 ? Math.min(100, Math.floor((received / total) * 100)) : -1;
        // One event per whole percent; a chunk-by-chunk stream would flood the updater.
        if (percent > reported) {
          reported = percent;
          onPercent(percent);
        }
        next(null, chunk);
      },
    }),
    NodeFS.createWriteStream(destination),
  );
  if (!sha512Matches(hash.digest(), file.sha512)) {
    throw fail("The downloaded macOS update does not match the checksum in latest-mac.yml.");
  }
}

async function extractCheckedApp(zipPath: string, dir: string, version: string): Promise<string> {
  const extracted = NodePath.join(dir, "extracted");
  await execFile("/usr/bin/ditto", ["-x", "-k", zipPath, extracted]);
  await NodeFSP.rm(zipPath, { force: true });
  const apps = (await NodeFSP.readdir(extracted)).filter((name) => name.endsWith(".app"));
  if (apps.length !== 1) throw fail("The macOS update archive does not hold exactly one app.");
  const stagedAppPath = NodePath.join(extracted, apps[0]!);
  const plistPath = NodePath.join(stagedAppPath, "Contents", "Info.plist");
  const [bundleId, bundleVersion] = await Promise.all([
    readPlistString(plistPath, "CFBundleIdentifier"),
    readPlistString(plistPath, "CFBundleShortVersionString"),
  ]);
  if (bundleId !== DESKTOP_APP_ID || bundleVersion !== version) {
    throw fail(
      `The macOS update archive holds ${bundleId} ${bundleVersion}, not CMDeck ${version}.`,
    );
  }
  return stagedAppPath;
}

const make = (): ElectronUpdater.ElectronUpdater["Service"] => {
  const base = ElectronUpdater.make;
  const events = new NodeEvents.EventEmitter();
  let offered = Option.none<MacUpdateInfo>();
  let genericFeedUrl: string | undefined;
  let staged: StagedUpdate | undefined;

  autoUpdater.on("update-available", (info: unknown) => {
    offered = decodeMacUpdateInfo(info);
  });
  autoUpdater.on("update-not-available", () => {
    offered = Option.none();
  });

  const download = async (): Promise<void> => {
    if (Option.isNone(offered)) throw fail("No macOS update was found. Check for updates again.");
    const info = offered.value;
    const appPath = runningAppPath();
    assertReplaceable(appPath);
    const isArm64Mac =
      HostProcess.Architecture.defaultValue() === "arm64" ||
      Electron.app.runningUnderARM64Translation;
    const file = Option.getOrThrowWith(selectMacUpdateZip(info.files, isArm64Mac), () =>
      fail(
        `CMDeck ${info.version} has no update for this Mac. Install it from ${MAC_UPDATE_RELEASES_URL}.`,
      ),
    );
    const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "cmdeck-update-"));
    let stagedAppPath: string;
    try {
      const zipPath = NodePath.join(dir, "update.zip");
      await downloadVerified(
        resolveMacUpdateFileUrl(info, file, genericFeedUrl),
        file,
        zipPath,
        (percent) => events.emit("download-progress", { percent }),
      );
      stagedAppPath = await extractCheckedApp(zipPath, dir, info.version);
      if (staged !== undefined) await NodeFSP.rm(staged.dir, { recursive: true, force: true });
      staged = { dir, appPath, stagedAppPath };
    } catch (error) {
      await NodeFSP.rm(dir, { recursive: true, force: true });
      throw error;
    }
    events.emit("update-downloaded", { version: info.version, downloadedFile: stagedAppPath });
  };

  const install = (): void => {
    if (staged === undefined || !NodeFS.existsSync(staged.stagedAppPath)) {
      throw fail("The downloaded macOS update is gone. Download it again.");
    }
    assertReplaceable(staged.appPath);
    NodeChildProcess.spawn(
      "/bin/sh",
      macInstallScriptArgs({
        pid: process.pid,
        appPath: staged.appPath,
        stagedAppPath: staged.stagedAppPath,
        relaunch: "/usr/bin/open",
      }),
      { detached: true, stdio: "ignore" },
    ).unref();
    // The helper waits for this process to exit; the normal quit stops every backend first.
    Electron.app.quit();
  };

  return ElectronUpdater.ElectronUpdater.of({
    ...base,
    setFeedURL: Effect.fn("MacBundleUpdater.setFeedURL")(function (options) {
      return Effect.suspend(() => {
        genericFeedUrl = typeof options === "string" ? options : (options as { url?: string }).url;
        return base.setFeedURL(options);
      });
    }),
    downloadUpdate: Effect.suspend(() => {
      const channel = autoUpdater.channel;
      return Effect.tryPromise({
        try: download,
        catch: (cause) =>
          new ElectronUpdater.ElectronUpdaterDownloadUpdateError({ channel, cause }),
      });
    }),
    quitAndInstall: Effect.fn("MacBundleUpdater.quitAndInstall")(function ({
      isSilent,
      isForceRunAfter,
    }) {
      return Effect.try({
        try: install,
        catch: (cause) =>
          new ElectronUpdater.ElectronUpdaterQuitAndInstallError({
            channel: autoUpdater.channel,
            isSilent,
            isForceRunAfter,
            cause,
          }),
      });
    }),
    on: Effect.fn("MacBundleUpdater.on")(function (eventName, listener) {
      const untypedListener = listener as unknown as (...args: Array<unknown>) => void;
      return base.on(eventName, listener).pipe(
        Effect.andThen(
          Effect.acquireRelease(
            Effect.sync(() => {
              events.on(eventName, untypedListener);
            }),
            () =>
              Effect.sync(() => {
                events.removeListener(eventName, untypedListener);
              }),
          ),
        ),
        Effect.asVoid,
      );
    }),
  });
};

export const layer = Layer.sync(ElectronUpdater.ElectronUpdater, make);
