/**
 * Stable keeps electron-updater's lookup (the latest release, never a prerelease). CMDeck tags are
 * not semver, which electron-updater's prerelease lookup requires, so Beta takes the newest
 * `vN` or `vN-beta.M` from the releases API and reads its beta*.yml or latest*.yml.
 */
import type { AppUpdater } from "electron-updater";
import { GitHubProvider } from "electron-updater/out/providers/GitHubProvider.js";
import { parseUpdateInfo } from "electron-updater/out/providers/Provider.js";
import { getChannelFilename, newUrlFromBase } from "electron-updater/out/util.js";

type ProviderArgs = ConstructorParameters<typeof GitHubProvider>;

export interface BetaTrackRelease {
  readonly tag: string;
  readonly beta: boolean;
  readonly name: string | undefined;
  readonly body: string | undefined;
}

const RELEASE_TAG = /^v([1-9]\d*)(?:-beta\.([1-9]\d*))?$/;

/** The newest published `vN` or `vN-beta.M` release; `vN` sorts above every `vN-beta.M`. */
export function newestBetaTrackRelease(releases: unknown): BetaTrackRelease | undefined {
  if (!Array.isArray(releases)) return undefined;
  let newest: { release: BetaTrackRelease; major: number; beta: number } | undefined;
  for (const release of releases as ReadonlyArray<Record<string, unknown> | null>) {
    if (release == null || release.draft === true || typeof release.tag_name !== "string") continue;
    const match = RELEASE_TAG.exec(release.tag_name);
    if (match === null) continue;
    const major = Number(match[1]);
    const beta = match[2] === undefined ? Number.POSITIVE_INFINITY : Number(match[2]);
    if (
      newest !== undefined &&
      (major < newest.major || (major === newest.major && beta <= newest.beta))
    )
      continue;
    newest = {
      major,
      beta,
      release: {
        tag: release.tag_name,
        beta: match[2] !== undefined,
        name: typeof release.name === "string" && release.name !== "" ? release.name : undefined,
        body: typeof release.body === "string" ? release.body : undefined,
      },
    };
  }
  return newest?.release;
}

export class CmdeckGitHubProvider extends GitHubProvider {
  private readonly appUpdater: AppUpdater;

  constructor(options: ProviderArgs[0], updater: ProviderArgs[1], runtimeOptions: ProviderArgs[2]) {
    super(options, updater, runtimeOptions);
    this.appUpdater = updater;
  }

  override async getLatestVersion(): ReturnType<GitHubProvider["getLatestVersion"]> {
    // DesktopUpdates turns prereleases on only for the Beta track.
    if (!this.appUpdater.allowPrerelease) return super.getLatestVersion();
    const { owner, repo } = this.options;
    const releasesUrl = new URL(
      `${this.computeGithubBasePath(`/repos/${owner}/${repo}/releases`)}?per_page=30`,
      this.baseApiUrl,
    );
    const newest = newestBetaTrackRelease(
      JSON.parse(
        (await this.httpRequest(releasesUrl, { Accept: "application/vnd.github+json" })) ?? "[]",
      ),
    );
    if (newest === undefined) {
      throw Object.assign(new Error("No published versions on GitHub"), {
        code: "ERR_UPDATER_NO_PUBLISHED_VERSIONS",
      });
    }
    const channelFile = getChannelFilename(
      this.getCustomChannelName(newest.beta ? "beta" : "latest"),
    );
    const channelFileUrl = newUrlFromBase(
      this.computeGithubBasePath(
        `/${owner}/${repo}/releases/download/${newest.tag}/${channelFile}`,
      ),
      this.baseUrl,
    );
    const info = parseUpdateInfo(
      await this.httpRequest(channelFileUrl),
      channelFile,
      channelFileUrl,
    );
    return {
      ...info,
      tag: newest.tag,
      releaseName: info.releaseName ?? newest.name ?? newest.tag,
      releaseNotes: info.releaseNotes ?? newest.body ?? null,
    };
  }
}
