/**
 * The pure half of CMDeck's macOS updater. Squirrel.Mac only accepts an update signed by the same
 * Developer ID as the running app, and CMDeck's macOS builds are only ad-hoc signed, so the app
 * downloads the release zip, checks it against latest-mac.yml and swaps the bundle itself.
 *
 * @module macBundleUpdate
 */
import { APP_RELEASE_REPOSITORY, appReleaseTag } from "@t3tools/shared/appIdentity";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export class MacBundleUpdateError extends Schema.TaggedError<MacBundleUpdateError>()(
  "MacBundleUpdateError",
  { reason: Schema.String, cause: Schema.optional(Schema.Defect()) },
) {
  override get message(): string {
    return this.reason;
  }
}

export const MAC_UPDATE_RELEASES_URL = `https://github.com/${APP_RELEASE_REPOSITORY}/releases`;

export const macUpdateLocationMessage = (appPath: string) =>
  `CMDeck can't replace itself at ${appPath}. Move CMDeck to the Applications folder and try again, or install the new version from ${MAC_UPDATE_RELEASES_URL}.`;

const MacUpdateFile = Schema.Struct({
  url: Schema.String,
  sha512: Schema.String,
  size: Schema.optional(Schema.Number),
});
export type MacUpdateFile = typeof MacUpdateFile.Type;

const MacUpdateInfo = Schema.Struct({
  version: Schema.String,
  files: Schema.Array(MacUpdateFile),
  tag: Schema.optional(Schema.String),
});
export type MacUpdateInfo = typeof MacUpdateInfo.Type;

export const decodeMacUpdateInfo = Schema.decodeUnknownOption(MacUpdateInfo);

/** The zip this Mac installs, as electron-updater would pick it: arm64 Macs prefer arm64 files. */
export function selectMacUpdateZip(
  files: ReadonlyArray<MacUpdateFile>,
  isArm64Mac: boolean,
): Option.Option<MacUpdateFile> {
  const zips = files.filter((file) => file.url.endsWith(".zip"));
  const isArm64File = (file: MacUpdateFile) => file.url.includes("arm64");
  const candidates =
    isArm64Mac && zips.some(isArm64File)
      ? zips.filter(isArm64File)
      : zips.filter((file) => !isArm64File(file));
  return Option.fromNullishOr(candidates[0]);
}

/**
 * Where a feed file is downloaded from. `genericFeedUrl` is a managed mirror or the mock server;
 * otherwise the file is an asset of the release the GitHub feed named.
 */
export function resolveMacUpdateFileUrl(
  info: MacUpdateInfo,
  file: MacUpdateFile,
  genericFeedUrl: string | undefined,
): string {
  const base =
    genericFeedUrl === undefined
      ? `${MAC_UPDATE_RELEASES_URL}/download/${encodeURIComponent(info.tag ?? appReleaseTag(info.version))}/`
      : genericFeedUrl.endsWith("/")
        ? genericFeedUrl
        : `${genericFeedUrl}/`;
  return new URL(file.url, base).href;
}

/** latest-mac.yml stores sha512 as base64; electron-updater also accepts 128 hex digits. */
export function sha512Matches(digest: Buffer, expected: string): boolean {
  const trimmed = expected.trim();
  return /^[0-9a-f]{128}$/iu.test(trimmed)
    ? digest.toString("hex") === trimmed.toLowerCase()
    : digest.toString("base64") === trimmed;
}

/** `/Applications/CMDeck.app/Contents/MacOS/CMDeck` -> `/Applications/CMDeck.app`. */
export function resolveMacAppBundlePath(executablePath: string): Option.Option<string> {
  const match = /^(\/.+?\.app)\/Contents\/MacOS\/[^/]+$/u.exec(executablePath);
  return Option.fromNullishOr(match?.[1]);
}

/** Gatekeeper runs a quarantined app from a random read-only path; replacing that changes nothing. */
export const isTranslocatedAppPath = (appPath: string) => appPath.includes("/AppTranslocation/");

/**
 * Run detached as `/bin/sh -c <script> sh <pid> <app> <staged> <relaunch>`. Waits for the app to
 * exit, moves the staged bundle beside the installed one, swaps them with two renames (putting the
 * old bundle back if the second fails), drops the quarantine flag and relaunches. Paths arrive as
 * arguments, so nothing is interpolated into the script.
 */
const MAC_INSTALL_SCRIPT = `pid="$1"; app="$2"; staged="$3"; relaunch="$4"
while kill -0 "$pid" 2>/dev/null; do sleep 0.2; done
new="$app.cmdeck-new.$$"
old="$app.cmdeck-old.$$"
rm -rf "$new" "$old"
if mv "$staged" "$new"; then
  xattr -dr com.apple.quarantine "$new" 2>/dev/null
  if mv "$app" "$old"; then
    if mv "$new" "$app"; then rm -rf "$old"; else mv "$old" "$app"; fi
  fi
fi
rm -rf "$new"
exec "$relaunch" "$app"
`;

export const macInstallScriptArgs = (input: {
  readonly pid: number;
  readonly appPath: string;
  readonly stagedAppPath: string;
  readonly relaunch: string;
}): ReadonlyArray<string> => [
  "-c",
  MAC_INSTALL_SCRIPT,
  "cmdeck-update",
  String(input.pid),
  input.appPath,
  input.stagedAppPath,
  input.relaunch,
];
