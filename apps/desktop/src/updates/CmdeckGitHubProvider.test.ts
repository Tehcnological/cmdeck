import * as NodeModule from "node:module";

import { describe, expect, it } from "vite-plus/test";

import { CmdeckGitHubProvider, newestBetaTrackRelease } from "./CmdeckGitHubProvider.ts";

type ProviderArgs = ConstructorParameters<typeof CmdeckGitHubProvider>;

// electron-updater's own dependency, which apps/desktop does not declare.
const semver = NodeModule.createRequire(
  NodeModule.createRequire(import.meta.url).resolve("electron-updater"),
)("semver") as { parse: (version: string) => ProviderArgs[1]["currentVersion"] };

const REPO = "/Tehcnological/cmdeck";
const release = (tag: string, extra: Record<string, unknown> = {}) => ({
  tag_name: tag,
  name: `CMDeck ${tag}`,
  body: `${tag} notes`,
  ...extra,
});
// GitHub lists releases newest first by creation, which a re-run or a late stable can reorder.
const releases = [
  release("v4-beta.1"),
  release("v3"),
  release("v5", { draft: true }),
  release("v3-beta.2"),
  release("v0.1.10-nightly.20261112.1"),
];

const offered = async (input: {
  readonly track: "latest" | "beta";
  readonly platform: NodeJS.Platform;
  readonly listed: ReadonlyArray<unknown>;
}) => {
  const requested: Array<string> = [];
  const request = async ({ path = "" }: { readonly path?: string | null }) => {
    requested.push(path ?? "");
    if (path === `${REPO}/releases.atom`) {
      return `<feed xmlns="http://www.w3.org/2005/Atom">${["v4-beta.1", "v3"]
        .map(
          (tag) =>
            `<entry><link rel="alternate" type="text/html" href="https://github.com${REPO}/releases/tag/${tag}"/><title>CMDeck ${tag}</title><content type="html">${tag}</content></entry>`,
        )
        .join("")}</feed>`;
    }
    // GitHub's latest release is never a prerelease.
    if (path === `${REPO}/releases/latest`) return JSON.stringify({ tag_name: "v3" });
    if (path?.startsWith(`/repos${REPO}/releases?`)) return JSON.stringify(input.listed);
    const feed = /\/releases\/download\/(v[^/]+)\/([^/?]+)/.exec(path ?? "");
    if (feed) {
      const version = feed[1]!.replace(/^v(\d+)/, "$1.0.0");
      return `version: ${version}\npath: CMDeck-${version}.zip\nsha512: abc\n`;
    }
    throw new Error(`404 ${path}`);
  };
  const provider = new CmdeckGitHubProvider(
    { provider: "github", owner: "Tehcnological", repo: "cmdeck" },
    {
      allowPrerelease: input.track === "beta",
      channel: input.track,
      currentVersion: semver.parse("3.0.0-beta.2"),
      fullChangelog: false,
    } as ProviderArgs[1],
    {
      isUseMultipleRangeRequest: false,
      platform: input.platform,
      executor: { request },
    } as ProviderArgs[2],
  );
  const info = await provider.getLatestVersion();
  return { tag: info.tag, version: info.version, feed: requested.at(-1)?.split("/").at(-1) };
};

describe("newestBetaTrackRelease", () => {
  it("picks the newest vN or vN-beta.M, a stable vN above its betas", () => {
    expect(newestBetaTrackRelease(releases)?.tag).toBe("v4-beta.1");
    expect(newestBetaTrackRelease([release("v3-beta.2"), release("v3")])).toMatchObject({
      tag: "v3",
      beta: false,
    });
    expect(newestBetaTrackRelease([release("v3-beta.2"), release("v3-beta.10")])?.tag).toBe(
      "v3-beta.10",
    );
    expect(newestBetaTrackRelease([release("v5", { draft: true }), release("v1.2.3")])).toBe(
      undefined,
    );
    expect(newestBetaTrackRelease({ message: "API rate limit exceeded" })).toBe(undefined);
  });
});

describe("CmdeckGitHubProvider", () => {
  it("keeps Stable on the latest release's latest*.yml, never a beta", async () => {
    expect(await offered({ track: "latest", platform: "darwin", listed: releases })).toEqual({
      tag: "v3",
      version: "3.0.0",
      feed: "latest-mac.yml",
    });
  });

  it.each([
    ["win32", "beta.yml"],
    ["darwin", "beta-mac.yml"],
    ["linux", "beta-linux.yml"],
  ] as const)("reads a beta's own feed on %s", async (platform, feed) => {
    expect(await offered({ track: "beta", platform, listed: releases })).toEqual({
      tag: "v4-beta.1",
      version: "4.0.0-beta.1",
      feed,
    });
  });

  it("moves Beta on to a stable release newer than every beta", async () => {
    expect(
      await offered({
        track: "beta",
        platform: "darwin",
        listed: [release("v3"), release("v3-beta.2")],
      }),
    ).toEqual({ tag: "v3", version: "3.0.0", feed: "latest-mac.yml" });
  });

  it("fails when GitHub lists no CMDeck release", async () => {
    await expect(offered({ track: "beta", platform: "win32", listed: [] })).rejects.toThrow(
      "No published versions on GitHub",
    );
  });
});
